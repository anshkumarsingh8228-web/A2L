/* Alone2Lone production realtime transport.
 * One authenticated WebSocket is shared by notifications, chat events and WebRTC signaling.
 */
(function(){
  'use strict';
  let ws=null, reconnectTimer=0, pingTimer=0, connecting=null, manualClose=false;
  let registered=false;

  const profile=()=>{
    try{return (typeof state!=='undefined'&&state.profile)||{};}catch{return {};}
  };
  const token=()=>{
  return window.a2lAuth?.getAccessToken?.()||'';
};
  const wsUrl=()=>`${location.protocol==='https:'?'wss':'ws'}://${location.host}`;

  function dispatch(message){
    window.dispatchEvent(new CustomEvent('a2l:ws-message',{detail:message}));

    if(message?.type==='notification'){
      window.dispatchEvent(new CustomEvent('a2l:notification',{detail:message.notification||{}}));
      if(typeof receiveBackendNotification==='function')receiveBackendNotification(message.notification);
    }

    if(message?.type==='chat-message'){
      window.dispatchEvent(new CustomEvent('a2l:chat-message',{detail:message}));
      if(typeof handleIncomingChatMessage==='function')handleIncomingChatMessage(message);
    }

    if(message?.type==='play-request'||message?.type==='play-invite'){
      if(typeof showIncomingRequest==='function')showIncomingRequest(message.request||message);
    }

    if(message?.type==='play-response'){
      if(typeof handlePlayResponse==='function')handlePlayResponse(message);
      else if(message.accepted&&typeof startSharedSession==='function')startSharedSession(message.request||message);
      else if(typeof toast==='function')toast('Game request declined');
    }

    if(message?.type==='play-session-update'){
      if(typeof handlePlaySessionUpdate==='function')handlePlaySessionUpdate(message);
      else if(typeof state!=='undefined'&&state.session&&state.session.type==='play'){
        state.session={...state.session,...(message.session||{})};
        if(typeof save==='function')save();
        if(typeof renderSharedSession==='function')renderSharedSession();
      }
    }

    if(message?.type==='group-invite'){
      if(typeof showIncomingGroupInvite==='function')showIncomingGroupInvite(message.request||message);
    }

    if(message?.type==='group-update'){
      if(typeof state!=='undefined'&&state.groupRooms&&message.roomId){
        state.groupRooms[message.roomId]=message.room||state.groupRooms[message.roomId];
        if(typeof save==='function')save();
        if(typeof renderGroupRoom==='function'&&state.session?.roomId===message.roomId)renderGroupRoom(message.roomId);
      }
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
        displayName:p.displayName||'A2L user',
        avatar:p.avatar||'🙂',
        ageGroup:p.ageGroup||'16-17',
        languages:p.languages||['english'],
        interests:p.interests||[],
        location:p.location||p.city||'',
        photoData:p.photoData||'',
        bio:p.bio||'',
        lookingFor:p.lookingFor||[],
        visibility:p.visibility||'public',
        privacy:p.privacy||{},
        matchPrefs:p.matchPrefs||{}
      }
    }));
    return true;
  }

  async function connect(){
    await window.a2lAuthReady?.catch?.(()=>{});
    if(ws?.readyState===WebSocket.OPEN){
      if(!registered)register();
      return ws;
    }
    if(connecting)return connecting;
    manualClose=false;

    connecting=new Promise((resolve,reject)=>{
      let settled=false;
      try{
        ws=new WebSocket(wsUrl());
      }catch(e){
        connecting=null;
        reject(e);
        return;
      }

      ws.onopen=()=>{
        registered=false;
        register();
        clearInterval(pingTimer);
        pingTimer=setInterval(()=>{
          if(ws?.readyState===WebSocket.OPEN)send({type:'ping'});
        },20000);
        
      };

      ws.onmessage=e=>{
        let m;
        try{m=JSON.parse(e.data);}catch{return;}
        if(m.type==='pong')return;
        if(m.type==='registered')registered=true;
        dispatch(m);
        if(m.type==='error'&&!settled){
          settled=true;
          clearTimeout(ws?.__registerTimeout);
          connecting=null;
          reject(new Error(m.message||'Realtime server error'));
        }else if(m.type==='registered'&&!settled){
          settled=true;
          clearTimeout(ws?.__registerTimeout);
          connecting=null;
          resolve(ws);
        }
      };

      ws.onerror=()=>{
        if(!settled){
          settled=true;
          connecting=null;
          reject(new Error('Realtime WebSocket connection failed.'));
        }
      };

      ws.onclose=()=>{
        clearInterval(pingTimer);
        const wasRegistered=registered;
        ws=null;
        registered=false;
        connecting=null;
        if(!manualClose&&document.visibilityState!=='hidden')scheduleReconnect();
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
    if(ws?.readyState!==WebSocket.OPEN)return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  function close(){
    manualClose=true;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    if(ws)ws.close();
    ws=null;
    registered=false;
  }

  function connected(){
    return ws?.readyState===WebSocket.OPEN&&registered;
  }

  document.addEventListener('DOMContentLoaded',()=>connect().catch(()=>{}));
  window.addEventListener('a2l:auth',e=>{
    if(e.detail?.session)connect().catch(()=>{});
  });
  window.addEventListener('online',()=>connect().catch(()=>{}));

  window.a2lRealtime={connect,send,close,connected,register};

  // Cross-tab and server-relayed UI signals
  function emitA2L(type,payload){
    const p=profile();
    const event={
      id:'evt_'+Date.now()+'_'+Math.random().toString(36).slice(2),
      type,
      payload,
      sender:p.a2lId,
      at:Date.now()
    };
    try{
      if(window.BroadcastChannel){
        window.__a2lBC=window.__a2lBC||new BroadcastChannel('alone2lone-live-v1');
        window.__a2lBC.postMessage(event);
      }
    }catch(e){}
    try{
      localStorage.setItem('aloneToLoneLive',JSON.stringify(event));
      localStorage.removeItem('aloneToLoneLive');
    }catch(e){}

    // Also send through WebSocket for cross-network/device delivery
    send({type,...(payload||{})});
  }
  window.emitA2L=emitA2L;

  function receiveA2L(event){
    if(!event||event.sender===profile().a2lId)return;
    const p=event.payload||{};
    if(event.type==='connection-request'&&p.to===profile().a2lId){
      state.connectionRequests[p.request.id]=p.request;
      save();
      if(typeof showConnectionRequest==='function')showConnectionRequest(p.request);
    }else if(event.type==='chat-request'&&p.to===profile().a2lId){
      state.chatRequests=state.chatRequests||{};
      state.chatRequests[p.request.id]=p.request;
      save();
      if(typeof renderChats==='function')renderChats();
      if(typeof toast==='function')toast('New chat request 📩');
    }else if(event.type==='play-request'&&p.to===profile().a2lId){
      if(typeof showIncomingRequest==='function')showIncomingRequest(p.request);
    }else if(event.type==='group-invite'&&p.to===profile().a2lId){
      if(typeof showIncomingGroupInvite==='function')showIncomingGroupInvite(p.request);
    }
  }

  try{
    if(window.BroadcastChannel){
      window.__a2lBC=new BroadcastChannel('alone2lone-live-v1');
      window.__a2lBC.onmessage=e=>receiveA2L(e.data);
    }
  }catch(e){}
  window.addEventListener('storage',e=>{
    if(e.key==='aloneToLoneLive'&&e.newValue){
      try{receiveA2L(JSON.parse(e.newValue));}catch(err){}
    }
  });

  function openModal(id){
    const m=$(id);
    if(!m)return;
    m.classList.add('show');
    m.setAttribute('aria-hidden','false');
  }
  function closeModal(id){
    const m=$(id);
    if(!m)return;
    m.classList.remove('show');
    m.setAttribute('aria-hidden','true');
  }
  window.openModal=openModal;
  window.closeModal=closeModal;
})();
