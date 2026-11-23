(() => {
 'use strict';
 const config=window.LOG_ACCESS,base=new URL(config.basePath,location.origin),status=document.querySelector('main [role=status]'),button=document.querySelector('[data-github-login]');
 const callback=new URL('access/github-callback.html',base),stateKey='log:oauth-state:'+base.pathname;
 const configured=config.authMode==='github-oauth-v1'&&/^[a-f0-9]{40}$/.test(config.revision||'')&&!!config.relay;
 const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
 const digest=async value=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
 const standalone=()=>navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true;
 let opening=false,working=false,pollTimer=null,externalReturn=false,waitingHandoff=false;
 function destination(address=location.href){try{const u=new URL(address,base);if(u.origin!==base.origin||!u.pathname.startsWith(base.pathname)||u.pathname.startsWith(base.pathname+'access/'))return new URL('#today',base).href;u.searchParams.delete('sign-in');u.searchParams.delete('code');u.searchParams.delete('state');return new URL(u.pathname+u.search+(u.hash||'#today'),base).href;}catch{return new URL('#today',base).href;}}
 function openApp(address){if(opening)return;opening=true;clearTimeout(pollTimer);const target=destination(address),url=new URL(target);if(url.pathname===location.pathname&&url.search===location.search){history.replaceState(null,'',target);location.reload();}else location.replace(target);}
 async function activate(){
  if(!navigator.serviceWorker||!crypto.subtle)throw new Error('请通过 HTTPS 或本机预览地址打开。');
  // A changed app revision must activate before the login message is sent.
  // Comparing only a fixed script URL can reuse a worker with older data rules.
  const worker=new URL('vault-worker.js',base);worker.search=new URLSearchParams({auth:'github-oauth-v3',revision:config.revision});
  await navigator.serviceWorker.register(worker,{scope:base.pathname,updateViaCache:'none'});
  const controlled=()=>navigator.serviceWorker.controller?.scriptURL===worker.href;if(controlled())return;
  await new Promise((resolve,reject)=>{const abort=new AbortController();const check=()=>{if(controlled()){clearTimeout(timer);abort.abort();resolve();}};const timer=setTimeout(()=>{abort.abort();reject(new Error('连接启动超时，请刷新。'));},12000);navigator.serviceWorker.addEventListener('controllerchange',check,{signal:abort.signal});check();});
 }
 const valid=p=>p&&Number.isFinite(p.at)&&Date.now()-p.at>=0&&Date.now()-p.at<=600000&&/^[A-Za-z0-9_-]{43}$/.test(p.state||'')&&/^[A-Za-z0-9_-]{43}$/.test(p.verifier||'')&&(!p.mode||p.mode==='normal'||p.mode==='standalone'&&/^[A-Za-z0-9_-]{43}$/.test(p.claim||''));
 async function remembered(){
  try{const raw=sessionStorage.getItem(stateKey);if(raw)return JSON.parse(raw)||{invalid:true};}catch{return{invalid:true};}
  return await window.LogMember.pendingLogin?.();
 }
 async function pending(expected){
  let value;try{value=JSON.parse(sessionStorage.getItem(stateKey)||'null');}catch{}
  if(!valid(value)||expected&&value.state!==expected)value=await window.LogMember.pendingLogin?.();
  return valid(value)&&(!expected||value.state===expected)?value:null;
 }
 async function remember(value){try{sessionStorage.setItem(stateKey,JSON.stringify(value));}catch{}await window.LogMember.rememberLogin?.(value);}
 async function clear(value){
  try{const saved=JSON.parse(sessionStorage.getItem(stateKey)||'null');if(!value||saved?.state===value.state)sessionStorage.removeItem(stateKey);}catch{}
  await window.LogMember.clearLogin?.(value?.state);
 }
 async function relay(data){
  const response=await fetch(config.relay,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify(data)});
  let result;try{result=await response.json();}catch{throw new Error('登入服务暂时无法连接，请稍后重试。');}
  if(!response.ok){const error=new Error(result.error||'GitHub 登入未完成。');error.status=response.status;throw error;}
  return result;
 }
 async function finish(code,value){
  const grant=await relay({code,verifier:value.verifier});
  await window.LogMember.login(grant.token,grant.expiresIn);
  await clear(value);
  if(value.mode==='standalone')await relay({action:'clear',state:value.state,claim:value.claim}).catch(()=>{});
  try{window.opener?.postMessage({type:'log-login-complete'},base.origin);}catch{}
  openApp(value.returnTo);
 }
 async function begin(){
  if(!configured)throw new Error('GitHub 登入服务尚未接通。');
  const old=await pending();if(old?.mode==='standalone')void relay({action:'clear',state:old.state,claim:old.claim}).catch(()=>{});
  const verifier=random(),state=random(),challenge=await digest(verifier),mode=standalone()?'standalone':'normal';
  const value={state,verifier,at:Date.now(),returnTo:destination(),mode};
  if(mode==='standalone'){value.claim=random();await relay({action:'prepare',state,claimHash:await digest(value.claim),challenge});}
  await remember(value);
  const url=new URL('https://github.com/login/oauth/authorize');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:callback.href,state,code_challenge:challenge,code_challenge_method:'S256',login:config.owner,allow_signup:'false'});
  location.assign(url.href);
 }
 function showExternalReturn(){externalReturn=true;status.textContent='登入确认已收到，请返回主屏幕上的 log。';button.textContent='回到 log';button.disabled=false;try{window.opener?.postMessage({type:'log-login-returned'},base.origin);}catch{}}
 async function redeem(){
  const query=new URLSearchParams(location.search),state=query.get('state'),code=query.get('code');history.replaceState(null,'',callback.pathname);
  await activate();const saved=await remembered(),value=valid(saved)&&saved.state===state?saved:null;
  if(saved&&!value){if(!valid(saved))await clear(saved);throw new Error('本次登入已失效，请重新登入。');}
  if(!value){
   if(/^[A-Za-z0-9_-]{43}$/.test(state||'')&&(/^[A-Za-z0-9_-]{10,160}$/.test(code||'')||query.get('error')==='access_denied')){
    await relay({action:'complete',state,...(query.has('error')?{error:'access_denied'}:{code})});showExternalReturn();return;
   }
   throw new Error('本次登入已失效，请重新登入。');
  }
  if(query.has('error')){await clear(value);throw new Error('GitHub 登入已取消。');}
  if(!/^[A-Za-z0-9_-]{10,160}$/.test(code||'')){await clear(value);throw new Error('本次登入已失效，请重新登入。');}
  status.textContent='正在核对 GitHub 登入…';
  try{await finish(code,value);}catch(error){if(error.status===400||error.status===401||error.status===403)await clear(value);throw error;}
 }
 async function resume(){
  if(working||opening||externalReturn)return;working=true;clearTimeout(pollTimer);
  try{
   const value=await pending();if(!value||value.mode!=='standalone'){if(waitingHandoff){waitingHandoff=false;throw new Error('本次登入已失效，请重新登入。');}return;}
   waitingHandoff=true;
   status.textContent='正在接续 GitHub 登入…';button.disabled=true;
   const result=await relay({action:'claim',state:value.state,claim:value.claim});
   if(result.cancelled){await clear(value);throw new Error('GitHub 登入已取消。');}
   if(result.code){await finish(result.code,value);return;}
   status.textContent='正在等待 GitHub 登入，请完成后回到 log。';button.textContent='重新登入';button.disabled=false;
   if(!document.hidden)pollTimer=setTimeout(()=>void resume(),2500);
  }catch(error){fail(error);}finally{working=false;}
 }
 async function start(){
  if(!configured)throw new Error('GitHub 登入服务尚未接通。');
  if(location.pathname===callback.pathname&&location.search){working=true;try{await redeem();}finally{working=false;}return;}
  await activate();if(await window.LogMember.session()){await clear();openApp();return;}
  const value=await pending();if(value?.mode==='standalone'){await resume();return;}
  status.textContent='';button.disabled=false;
 }
 button.addEventListener('click',()=>{
  if(externalReturn){try{window.close();}catch{}status.textContent='请点主屏幕上的 log，登入会自动接续。';return;}
  clearTimeout(pollTimer);button.disabled=true;status.textContent='正在打开 GitHub…';begin().catch(fail);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void resume();});window.addEventListener('pageshow',()=>void resume());window.addEventListener('online',()=>void resume());
 function fail(error){if(opening)return;status.textContent=(error.message||'暂时无法登入，请重试。').replaceAll('登录','登入');button.textContent='使用 GitHub 登入';button.disabled=!configured;}
 start().catch(fail);
})();
