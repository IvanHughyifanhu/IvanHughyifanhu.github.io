(() => {
 'use strict';
 const body=document.body,base=new URL('../',document.currentScript.src);let redirecting=null;
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
 navigator.serviceWorker?.register(worker,{scope:base.pathname,updateViaCache:'none'}).catch(()=>{});
})();
