(() => {
 'use strict';
 const body=document.body,base=new URL('../',document.currentScript.src);let redirecting=null,releaseChecking=false,pendingReload=false;
 async function login(){
  if(redirecting)return redirecting;
  redirecting=(async()=>{try{await window.LogPrepareForLogin?.();body.hidden=true;const url=new URL(base);url.searchParams.set('sign-in','1');location.replace(url.href);}catch(error){redirecting=null;body.hidden=false;const warning=document.querySelector('#fatal');if(warning){warning.hidden=false;warning.textContent='请先复制当前输入：本机草稿保存未完成。';}throw error;}})();
  return redirecting;
 }
 window.LogRequestLogin=login;
 navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='private-logout')void login().catch(()=>{});});
 addEventListener('pagehide',()=>{body.hidden=true;});
 addEventListener('pageshow',async()=>{try{if(await window.LogMember.session())body.hidden=false;else await login();}catch{void login().catch(()=>{});}});
 const current=navigator.serviceWorker?.controller?.scriptURL;
 let worker=new URL('vault-worker.js?auth=github-oauth-v3',base);
 if(current){const active=new URL(current);if(active.origin===base.origin&&active.pathname===worker.pathname)worker=active;}
 if(!current)navigator.serviceWorker?.register(worker,{scope:base.pathname,updateViaCache:'none'}).catch(()=>{});
 // Existing signed-in pages must discover releases too, without clearing their
 // session, IndexedDB or unfinished drafts. A revision-specific worker avoids
 // an older cached worker URL continuing to serve a previous application.
 function editing(){return !!document.querySelector('dialog[open],.project-picker[open]')||!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');}
 async function reloadRelease(){
  if(editing()){pendingReload=true;return;}await window.LogPrepareForLogin?.();if(editing()){pendingReload=true;return;}if(!redirecting){pendingReload=false;location.reload();}
 }
 async function refreshRelease(){
  if(!navigator.serviceWorker||navigator.onLine===false)return;
  const url=new URL('access/config.js',base);url.searchParams.set('check',String(Date.now()));
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});if(!response.ok)return;
  const match=(await response.text()).trim().match(/^window\.LOG_ACCESS=Object\.freeze\((\{[\s\S]*\})\);?$/);if(!match)return;
  const config=JSON.parse(match[1]);if(config.ownerId!==199221372||config.repository!=='log-private'||config.origin!==base.origin||config.basePath!==base.pathname||!/^[a-f0-9]{40}$/.test(config.revision||''))return;
  const next=new URL('vault-worker.js',base);next.search=new URLSearchParams({auth:'github-oauth-v3',revision:config.revision});
  if(navigator.serviceWorker.controller?.scriptURL===next.href){if(pendingReload)await reloadRelease();return;}
  await navigator.serviceWorker.register(next,{scope:base.pathname,updateViaCache:'none'});
  const controlled=()=>navigator.serviceWorker.controller?.scriptURL===next.href;
  if(!controlled())await new Promise((resolve,reject)=>{const abort=new AbortController(),timer=setTimeout(()=>{abort.abort();reject(new Error('Update not ready'));},12000);const check=()=>{if(controlled()){clearTimeout(timer);abort.abort();resolve();}};navigator.serviceWorker.addEventListener('controllerchange',check,{signal:abort.signal});check();});
  if(!controlled()||redirecting)return;await reloadRelease();
 }
 async function checkRelease(){if(releaseChecking||document.hidden||editing())return;releaseChecking=true;try{await refreshRelease();}catch{}finally{releaseChecking=false;}}
 void checkRelease();document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkRelease();});addEventListener('online',()=>void checkRelease());setInterval(()=>void checkRelease(),60000);
})();
