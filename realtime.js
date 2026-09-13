/* Alone2Lone production realtime transport.
 * One authenticated WebSocket is shared by notifications, chat events and WebRTC signaling.
 */
(function(){
  'use strict';
  let ws=null, reconnectTimer=0, connecting=null, manualClose=false;
  let registered=false;

  const profile=()=>{
    try{return (typeof state!=='undefined'&&state.profile)||{};}catch{return {};}
  };
  const token=()=>window.a2lAuth?.getAccessToken?.()||'';
  const wsUrl=()=>`${location.protocol==='https:'?'wss':'ws'}://${location.host}`;

  function dispatch(message){
    window.dispatchEvent(new CustomEvent('a2l:ws-message',{detail:message}));
    if(message?.type==='notification'){
      window.dispatchEvent(new CustomEvent('a2l:notification',{detail:message.notification||{}}));
      if(typeof receiveBackendNotification==='function')receiveBackendNotification(message.notification);
    }
  }

  function register(){
    const p=profile();
    if(!ws || ws.readyState!==WebSocket.OPEN)return false;
    ws.send(JSON.stringify({
      type:'register',
      token:token(),
      id:p.a2lId,
      profile:{
        displayName:p.displayName, avatar:p.avatar, ageGroup:p.ageGroup,
        languages:p.languages||['english'], interests:p.interests||[],
        location:p.location||p.city||'', photoData:p.photoData||'',
        bio:p.bio||'', lookingFor:p.lookingFor||[],
        visibility:p.visibility||'private', privacy:p.privacy||{},
        matchPrefs:p.matchPrefs||{}
      }
    }));
    return true;
  }

  async function connect(){
    await window.a2lAuthReady?.catch?.(()=>{});
    if(!token())throw new Error('Authentication required for realtime connection.');
    if(ws?.readyState===WebSocket.OPEN){if(!registered)register();return ws;}
    if(connecting)return connecting;
    manualClose=false;
    connecting=new Promise((resolve,reject)=>{
      let settled=false;
      try{ws=new WebSocket(wsUrl());}catch(e){connecting=null;reject(e);return;}
      ws.onopen=()=>{
        registered=false;
        register();
        const t=setTimeout(()=>{if(!settled){settled=true;connecting=null;resolve(ws);}},3000);
        ws.__registerTimeout=t;
      };
      ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
        if(m.type==='registered')registered=true;
        dispatch(m);
        if(m.type==='error' && !settled){settled=true;clearTimeout(ws?.__registerTimeout);connecting=null;reject(new Error(m.message||'Realtime server error'));}
        else if(m.type==='registered'&&!settled){settled=true;clearTimeout(ws?.__registerTimeout);connecting=null;resolve(ws);}
      };
      ws.onerror=()=>{if(!settled){settled=true;connecting=null;reject(new Error('Realtime WebSocket connection failed.'));}};
      ws.onclose=()=>{
        const wasRegistered=registered;ws=null;registered=false;connecting=null;
        if(!manualClose && document.visibilityState!=='hidden')scheduleReconnect();
        if(wasRegistered)dispatch({type:'realtime-disconnected'});
      };
    });
    return connecting;
  }

  function scheduleReconnect(){
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(()=>connect().catch(()=>{}),2000);
  }
  function send(message){
    if(ws?.readyState!==WebSocket.OPEN || !registered)return false;
    ws.send(JSON.stringify(message));return true;
  }
  function close(){manualClose=true;clearTimeout(reconnectTimer);if(ws)ws.close();ws=null;registered=false;}
  function connected(){return ws?.readyState===WebSocket.OPEN && registered;}

  document.addEventListener('DOMContentLoaded',()=>connect().catch(()=>{}));
  window.addEventListener('a2l:auth',e=>{if(e.detail?.session)connect().catch(()=>{})});
  window.addEventListener('online',()=>connect().catch(()=>{}));

  window.a2lRealtime={connect,send,close,connected};

  // Keep the legacy cross-tab event path for non-server UI signals only.
  function emitA2L(type,payload){
    const p=profile();const event={id:'evt_'+Date.now()+'_'+Math.random().toString(36).slice(2),type,payload,sender:p.a2lId,at:Date.now()};
    try{if(window.BroadcastChannel){window.__a2lBC=window.__a2lBC||new BroadcastChannel('alone2lone-live-v1');window.__a2lBC.postMessage(event)}}catch(e){}
    try{localStorage.setItem('aloneToLoneLive',JSON.stringify(event));localStorage.removeItem('aloneToLoneLive')}catch(e){}
  }
  window.emitA2L=emitA2L;

  function receiveA2L(event){
    if(!event||event.sender===profile().a2lId)return;
    // Only legacy UI request events are handled here; calls/messages use the server socket.
    const p=event.payload||{};
    if(event.type==='connection-request'&&p.to===profile().a2lId){state.connectionRequests[p.request.id]=p.request;save();showConnectionRequest(p.request);}
    else if(event.type==='chat-request'&&p.to===profile().a2lId){state.chatRequests=state.chatRequests||{};state.chatRequests[p.request.id]=p.request;save();if(typeof renderChats==='function')renderChats();toast('New chat request 📩');}
  }
  try{if(window.BroadcastChannel){window.__a2lBC=new BroadcastChannel('alone2lone-live-v1');window.__a2lBC.onmessage=e=>receiveA2L(e.data)}}catch(e){}
  window.addEventListener('storage',e=>{if(e.key==='aloneToLoneLive'&&e.newValue){try{receiveA2L(JSON.parse(e.newValue))}catch(err){}}});

  function openModal(id){const m=$(id);if(!m)return;m.classList.add('show');m.setAttribute('aria-hidden','false')}
  function closeModal(id){const m=$(id);if(!m)return;m.classList.remove('show');m.setAttribute('aria-hidden','true')}
  window.openModal=openModal;window.closeModal=closeModal;
})();
