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
 navigator.serviceWorker?.register(new URL('vault-worker.js?auth=github-oauth-v2',base),{scope:base.pathname,updateViaCache:'none'}).catch(()=>{});
})();
