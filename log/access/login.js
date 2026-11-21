(() => {
 'use strict';
 const config=window.LOG_ACCESS,base=new URL(config.basePath,location.origin),status=document.querySelector('main [role=status]'),button=document.querySelector('[data-github-login]');
 const callback=new URL('access/github-callback.html',base),stateKey='log:oauth-state:'+base.pathname;
 const ready=config.authMode==='github-oauth-v1'&&/^[a-f0-9]{40}$/.test(config.revision||'')&&!!config.relay;
 const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
 function destination(address=location.href){try{const u=new URL(address,base);return u.origin===base.origin&&u.pathname.startsWith(base.pathname)&&!u.pathname.startsWith(base.pathname+'access/')?new URL(u.pathname+u.search+(u.hash||'#overview'),base).href:new URL('#overview',base).href;}catch{return new URL('#overview',base).href;}}
 function openApp(address){const target=destination(address),url=new URL(target);if(url.pathname===location.pathname&&url.search===location.search){history.replaceState(null,'',target);location.reload();}else location.replace(target);}
 async function activate(){
  if(!navigator.serviceWorker||!crypto.subtle)throw new Error('请通过 HTTPS 或本机预览地址打开。');
  const worker=new URL('vault-worker.js?auth=github-oauth-v1',base);
  await navigator.serviceWorker.register(worker,{scope:base.pathname,updateViaCache:'none'});
  const controlled=()=>navigator.serviceWorker.controller?.scriptURL===worker.href;if(controlled())return;
  await new Promise((resolve,reject)=>{const abort=new AbortController();const check=()=>{if(controlled()){clearTimeout(timer);abort.abort();resolve();}};const timer=setTimeout(()=>{abort.abort();reject(new Error('连接启动超时，请刷新。'));},10000);navigator.serviceWorker.addEventListener('controllerchange',check,{signal:abort.signal});check();});
 }
 async function begin(){
  if(!ready)throw new Error('GitHub 登录服务尚未接通。');
  const verifier=random(),state=random(),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(stateKey,JSON.stringify({state,verifier,at:Date.now(),returnTo:destination()}));
  const url=new URL('https://github.com/login/oauth/authorize');
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:callback.href,state,code_challenge:challenge,code_challenge_method:'S256',login:config.owner,allow_signup:'false'});
  location.assign(url.href);
 }
 async function redeem(){
  const query=new URLSearchParams(location.search);history.replaceState(null,'',callback.pathname);
  let pending;try{pending=JSON.parse(sessionStorage.getItem(stateKey)||'null');}catch{pending=null;}sessionStorage.removeItem(stateKey);
  if(query.has('error'))throw new Error('GitHub 登录已取消。');
  if(!pending||!Number.isFinite(pending.at)||Date.now()-pending.at<0||Date.now()-pending.at>10*60000||query.get('state')!==pending.state||!/^[A-Za-z0-9_-]{43}$/.test(pending.state||'')||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier||'')||!/^[A-Za-z0-9_-]{10,160}$/.test(query.get('code')||''))throw new Error('本次登录已失效，请重新登录。');
  if(!ready)throw new Error('GitHub 登录服务尚未接通。');
  status.textContent='正在核对 GitHub 登录…';
  const res=await fetch(config.relay,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify({code:query.get('code'),verifier:pending.verifier})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'GitHub 登录未完成。');
  await activate();await window.LogMember.login(data.token,data.expiresIn);openApp(pending.returnTo);
 }
 async function start(){
  if(location.pathname===callback.pathname&&location.search){await redeem();return;}
  if(!ready)throw new Error('GitHub 登录服务尚未接通。');
  await activate();if(await window.LogMember.session()){openApp();return;}status.textContent='';button.disabled=false;
 }
 button.addEventListener('click',()=>{button.disabled=true;status.textContent='正在打开 GitHub…';begin().catch(fail);});
 function fail(error){status.textContent=error.message||'暂时无法登录，请重试。';button.disabled=!ready;}
 start().catch(fail);
})();
