(() => {
  'use strict';
  const body=document.body,login=()=>{body.hidden=true;location.replace(new URL('./',location.href));};
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='private-logout')login();});
  addEventListener('pagehide',()=>{body.hidden=true;});
  addEventListener('pageshow',async()=>{try{if(await window.LogMember.session())body.hidden=false;else login();}catch{login();}});
})();
