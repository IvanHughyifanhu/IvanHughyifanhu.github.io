(() => {
  'use strict';
  function call(type,data={}) {
    const worker=navigator.serviceWorker?.controller;
    if(!worker)return Promise.reject(new Error('访问服务尚未就绪，请刷新。'));
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timer=setTimeout(()=>{channel.port1.close();reject(new Error('连接超时，请重试。'));},type==='login'?120000:30000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve(event.data.result):reject(new Error(event.data?.error||'连接失败，请重试。'));};
      worker.postMessage({type,...data},[channel.port2]);
    });
  }
  window.LogMember={login:(token,expiresIn)=>call('login',{token,expiresIn}),session:()=>call('session'),logout:()=>call('logout'),rememberLogin:pending=>call('login-pending-save',{pending}),pendingLogin:()=>call('login-pending-read'),clearLogin:state=>call('login-pending-clear',{state})};
})();
