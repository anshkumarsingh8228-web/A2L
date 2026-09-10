/* A2L live presence + friend relationships. */
(function(){
  'use strict';
  let ws=null, retry=null;
  const $=id=>document.getElementById(id);
  const mySession=()=>window.a2lIdentity?.getSessionId?.()||'';
  const wsUrl=()=> (location.protocol==='https:'?'wss://':'ws://')+location.host;
  const payload=()=>({a2lId:state.profile.a2lId||'',name:state.profile.displayName||'A2L user',avatar:state.profile.avatar||'🙂',ageGroup:state.profile.ageGroup||'',languages:state.profile.languages||[],interests:state.profile.interests||[],bio:state.profile.bio||'',status:state.profile.status||'Available to chat'});
  const send=m=>{if(ws?.readyState===1)ws.send(JSON.stringify(m));else if(window.a2lRealMatch?.sendRaw)window.a2lRealMatch.sendRaw(m);};
  const stableId=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return -Math.max(1000,Math.abs(h|0));};
  function upsertUsers(list){
    const old=new Map(friends.map(f=>[String(f.userId||f.a2lId),f]));
    friends.length=0;
    (list||[]).forEach(u=>{
      const uid=String(u.userId||u.a2lId||'');
      if(!uid||uid===mySession()||u.a2lId===state.profile.a2lId)return;
      const prev=old.get(uid)||{};
      friends.push({id:prev.id||stableId(uid),userId:uid,a2lId:String(u.a2lId||uid),name:u.name||'A2L user',avatar:u.avatar||'🙂',ageGroup:u.ageGroup||'',languages:u.languages||[],interests:u.interests||[],bio:u.bio||'',online:u.online!==false,inCall:!!u.inCall,status:u.status||'',isFriend:!!u.isFriend});
    });
    renderAll();
  }
  function renderAll(){if(typeof renderPeople==='function')renderPeople();if(typeof renderProfile==='function')renderProfile();if(typeof renderChats==='function')renderChats();document.dispatchEvent(new CustomEvent('a2l:friends-updated'));}
  function applyFriendList(list){
    const byUid=new Map(friends.map(f=>[String(f.userId||f.a2lId),f]));
    (list||[]).forEach(u=>{
      const uid=String(u.userId||u.a2lId||''); if(!uid)return;
      let f=byUid.get(uid)||{id:stableId(uid),userId:uid,a2lId:String(u.a2lId||uid),name:'A2L user',avatar:'🙂',languages:[],interests:[]};
      Object.assign(f,{userId:uid,a2lId:String(u.a2lId||f.a2lId||uid),name:u.name||f.name,avatar:u.avatar||f.avatar,ageGroup:u.ageGroup||f.ageGroup,languages:u.languages||f.languages,interests:u.interests||f.interests,bio:u.bio||f.bio,online:!!u.online,inCall:!!u.inCall,status:u.status||f.status,isFriend:true});
      byUid.set(uid,f);
    });
    upsertUsers(Array.from(byUid.values()));
    state.connections=friends.filter(f=>f.isFriend).map(f=>f.id); save();
  }
  function connect(){
    // The live call engine owns the primary socket. Sharing it avoids two
    // sockets registering the same session and replacing one another.
    if(window.a2lRealMatch?.onMessage){ window.a2lRealMatch.onMessage(handle); return; }
    if(ws&&[0,1].includes(ws.readyState))return;
    clearTimeout(retry);
    try{ws=new WebSocket(wsUrl())}catch(_){return}
    ws.onopen=()=>send({type:'register',sessionId:mySession(),profile:payload(),name:state.profile.displayName||'A2L user'});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}handle(m)};
    ws.onclose=()=>{ws=null;friends.forEach(f=>{f.online=false;f.inCall=false});renderAll();retry=setTimeout(connect,2000)};
  }
  function findByTarget(value){const s=String(value||'');return friends.find(f=>f.userId===s||f.a2lId.toLowerCase()===s.toLowerCase()||f.name.toLowerCase()===s.toLowerCase());}
  function request(target,source='profile'){
    const f=typeof target==='object'?target:findByTarget(target); if(!f)return false;
    if(f.isFriend){toast(`${f.name} is already your friend 🤝`);return false}
    if(!f.userId){toast('That user is no longer available');return false}
    const existing=state.outgoingConnectionRequests?.[f.userId];if(existing?.status==='pending'){toast('Friend request already sent');return false}
    const req={id:'fr_'+Date.now()+'_'+Math.random().toString(36).slice(2),from:mySession(),fromA2lId:state.profile.a2lId,fromName:state.profile.displayName,to:f.userId,toA2lId:f.a2lId,status:'pending',at:Date.now(),source,profile:payload()};
    state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};state.outgoingConnectionRequests[f.userId]=req;save();
    if(ws?.readyState===1)send({type:'friend-request',to:f.userId,request:req});else {toast('Reconnecting… please try again');connect();return false}
    toast('Friend request sent 🤝');return true;
  }
  function accept(req){if(req?.from)send({type:'friend-response',to:req.from,requestId:req.id,accepted:true});}
  function decline(req){if(req?.from)send({type:'friend-response',to:req.from,requestId:req.id,accepted:false});}
  function showIncoming(req){
    state.connectionRequests=state.connectionRequests||{};state.connectionRequests[req.id]=req;save();window.__a2lLiveIncoming=req;
    if(typeof showConnectionRequest==='function')showConnectionRequest(req);else {if($('connectionRequestText'))$('connectionRequestText').textContent=`${req.fromName||'A2L user'} wants to connect with you.`;if(typeof openModal==='function')openModal('connectionRequestModal');}
  }
  function applyAccepted(other){
    const uid=String(other.userId||other.a2lId||'');let f=friends.find(x=>x.userId===uid||x.a2lId===other.a2lId);
    if(!f){f={id:stableId(uid),userId:uid,a2lId:String(other.a2lId||uid),name:other.name||other.fromName||'A2L user',avatar:other.avatar||'🙂',online:!!other.online,inCall:!!other.inCall,languages:other.languages||[],interests:other.interests||[],bio:other.bio||'',isFriend:true};friends.push(f)}
    f.isFriend=true;state.connections=Array.from(new Set([...(state.connections||[]),f.id]));
    const c=state.chats[f.id]||{messages:[],source:'friend',ended:false,locked:false,startedAt:Date.now(),livePeerId:f.userId};c.source='friend';c.ended=false;c.locked=false;c.livePeerId=f.userId;state.chats[f.id]=c;save();renderAll();toast('Friend request accepted 🤝');
  }
  function handle(m){
    if(m.type==='presence-list'||m.type==='presence-update'){upsertUsers(m.users||[]);return}
    if(m.type==='friend-list'){applyFriendList(m.friends||[]);return}
    if(m.type==='friend-request'){showIncoming(m.request||{id:'fr_'+Date.now(),from:m.from,fromName:m.fromName,to:mySession(),status:'pending',profile:m.profile});return}
    if(m.type==='friend-response'){
      const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===m.requestId);
      if(req)req.status=m.accepted?'accepted':'declined';
      if(m.accepted)applyAccepted(m.friend||{userId:m.from,name:m.fromName,a2lId:m.friend?.a2lId||m.from}); else {save();toast('Friend request declined');renderAll();}
      return;
    }
  }
  window.a2lSocial={connect,request,accept,decline,send,sessionId:mySession,profilePayload:payload,findByTarget};
  window.a2lSocialSessionId=mySession;
  document.addEventListener('DOMContentLoaded',()=>setTimeout(connect,0),{once:true});
  if(document.readyState!=='loading')setTimeout(connect,0);
})();
