(() => {
 'use strict';
 const config=window.LOG_ACCESS,base=new URL(config.basePath,location.origin),status=document.querySelector('main [role=status]'),button=document.querySelector('[data-github-login]');
 const dialog=document.querySelector('#connect-dialog'),form=document.querySelector('#connect-form'),input=document.querySelector('#github-token'),submit=form.querySelector('[type=submit]'),message=document.querySelector('#connect-status');
 const ready=config.authMode==='github-pat-v1'&&/^[a-f0-9]{40}$/.test(config.revision||'');
 const tokenURL=new URL('https://github.com/settings/personal-access-tokens/new');tokenURL.search=new URLSearchParams({name:'log',description:'log private journal sync',target_name:config.owner,expires_in:'365',contents:'write'});document.querySelector('#create-token').href=tokenURL.href;
 function destination(){const u=new URL(location.href);return u.origin===base.origin&&u.pathname.startsWith(base.pathname)&&!u.pathname.startsWith(base.pathname+'access/')?new URL(u.pathname+u.search+(u.hash||'#overview'),base).href:new URL('#overview',base).href;}
 function openApp(){const target=destination(),url=new URL(target);if(url.pathname===location.pathname&&url.search===location.search){history.replaceState(null,'',target);location.reload();}else location.replace(target);}
 async function activate(){
  if(!navigator.serviceWorker||!crypto.subtle)throw new Error('请通过 HTTPS 或本机预览地址打开。');
  const worker=new URL('vault-worker.js',base);
  await navigator.serviceWorker.register(worker,{scope:base.pathname,updateViaCache:'none'});
  const controlled=()=>navigator.serviceWorker.controller?.scriptURL===worker.href;if(controlled())return;
  await new Promise((resolve,reject)=>{const abort=new AbortController();const check=()=>{if(controlled()){clearTimeout(timer);abort.abort();resolve();}};const timer=setTimeout(()=>{abort.abort();reject(new Error('连接启动超时，请刷新。'));},10000);navigator.serviceWorker.addEventListener('controllerchange',check,{signal:abort.signal});check();});
 }
 async function start(){if(!ready)throw new Error('应用尚未发布。');await activate();if(await window.LogMember.session()){openApp();return;}status.textContent='';button.disabled=false;}
 button.addEventListener('click',()=>{message.textContent='';dialog.showModal();input.focus();});form.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{input.value='';});
 form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;input.readOnly=true;message.textContent='正在验证 GitHub…';try{await activate();await window.LogMember.login(input.value.trim());input.value='';openApp();}catch(error){input.value='';message.textContent=error.message||'连接未完成，请重试。';}finally{submit.disabled=false;input.readOnly=false;}};
 start().catch(error=>{status.textContent=error.message||'暂时无法连接。';button.disabled=!ready;});
})();
