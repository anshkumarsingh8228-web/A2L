/* A2L Phase 7 — real presence + friend relationships. */
(function(){
  'use strict';
  let ws=null;
  const $=id=>document.getElementById(id);
  const esc=v=>typeof escapeHTML==='function'?escapeHTML(v):String(v??'');
  function wsUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host}
  function profilePayload(){return {name:state.profile.displayName||'A2L user',avatar:state.profile.avatar||'🙂',ageGroup:state.profile.ageGroup||'',languages:state.profile.languages||[],interests:state.profile.interests||[],bio:state.profile.bio||'',status:state.profile.status||'Available to chat'}}
  function send(m){if(ws?.readyState===1)ws.send(JSON.stringify(m))}
  function upsertUsers(list){
    const old=new Map(friends.map(f=>[String(f.a2lId),f]));
    friends.length=0;
    (list||[]).forEach(u=>{
      if(!u?.a2lId||u.a2lId===state.profile.a2lId)return;
      const prev=old.get(String(u.a2lId))||{};
      friends.push({id:prev.id||stableId(u.a2lId),name:u.name||'A2L user',a2lId:u.a2lId,avatar:u.avatar||'🙂',ageGroup:u.ageGroup||'',languages:u.languages||[],interests:u.interests||[],bio:u.bio||'',online:u.online!==false,inCall:!!u.inCall,status:u.status||'',isFriend:!!u.isFriend});
    });
    friends.forEach(f=>{if(f.online&&!f.isFriend)f.isFriend=false});
    if(typeof renderPeople==='function')renderPeople();
    if(typeof renderProfile==='function')renderProfile();
    if(typeof renderChats==='function')renderChats();
    document.dispatchEvent(new CustomEvent('a2l:friends-updated'));
  }
  function stableId(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return -Math.max(1000,Math.abs(h|0))}
  function applyFriendList(list){
    const current=new Map(friends.map(f=>[String(f.a2lId),f]));
    (list||[]).forEach(u=>{
      if(!u?.a2lId||u.a2lId===state.profile.a2lId)return;
      const f=current.get(String(u.a2lId));
      const base=f||{id:stableId(u.a2lId),name:'A2L user',avatar:'🙂',languages:[],interests:[]};
      Object.assign(base,{name:u.name||base.name,a2lId:u.a2lId,avatar:u.avatar||base.avatar,ageGroup:u.ageGroup||base.ageGroup,languages:u.languages||base.languages,interests:u.interests||base.interests,bio:u.bio||base.bio,online:!!u.online,inCall:!!u.inCall,status:u.status||'',isFriend:true});
      current.set(String(u.a2lId),base);
    });
    const keep=new Set((list||[]).map(x=>String(x.a2lId)));
    for(const [k,f] of current){if(f.isFriend&&!keep.has(k))f.online=false}
    upsertUsers(Array.from(current.values()).filter(f=>f.a2lId!==state.profile.a2lId));
    state.connections=friends.filter(f=>f.isFriend).map(f=>f.id);save();
  }
  function markPending(req){
    state.connectionRequests=state.connectionRequests||{};state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};
    if(req.from===state.profile.a2lId)state.outgoingConnectionRequests[req.to]=req; else state.connectionRequests[req.id]=req;
    save();
  }
  function connect(){
    if(ws&&[0,1].includes(ws.readyState))return;
    ws=new WebSocket(wsUrl());
    ws.onopen=()=>send({type:'register',sessionId:sessionId(),name:state.profile.displayName||'A2L user',profile:profilePayload()});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
    ws.onclose=()=>{ws=null;friends.forEach(f=>{f.online=false;f.inCall=false});if(typeof renderPeople==='function')renderPeople();if(typeof renderProfile==='function')renderProfile();};
  }
  function sessionId(){try{return sessionStorage.getItem('a2l_device_session_id')||''}catch(_){return ''}}
  function request(to,source='profile'){
    const f=friends.find(x=>x.a2lId===to);if(!f)return false;
    if(f.isFriend){toast(`${f.name} is already your friend 🤝`);return false}
    const existing=state.outgoingConnectionRequests?.[to];if(existing?.status==='pending'){toast('Friend request already sent');return false}
    const req={id:'fr_'+Date.now()+'_'+Math.random().toString(36).slice(2),from:state.profile.a2lId,fromName:state.profile.displayName,to,status:'pending',at:Date.now(),source,profile:profilePayload()};
    state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};state.outgoingConnectionRequests[to]=req;save();
    if(ws?.readyState===1)send({type:'friend-request',to,request:req});else toast('Reconnecting… please try again');
    toast('Friend request sent 🤝');return true;
  }
  function accept(req){send({type:'friend-response',to:req.from,requestId:req.id,accepted:true});}
  function decline(req){send({type:'friend-response',to:req.from,requestId:req.id,accepted:false});}
  function showIncoming(req){
    markPending(req);window.__a2lLiveIncoming={...req};
    if(typeof showConnectionRequest==='function')showConnectionRequest(req);else { const x=$('connectionRequestText');if(x)x.textContent=`${req.fromName||'A2L user'} wants to be your friend.`; if(typeof openModal==='function')openModal('connectionRequestModal'); }
  }
  function applyAccepted(other){
    const f=friends.find(x=>x.a2lId===other.a2lId);
    if(f){f.isFriend=true;f.online=!!other.online;f.inCall=!!other.inCall;state.connections=Array.from(new Set([...(state.connections||[]),f.id]));}
    save();if(typeof renderPeople==='function')renderPeople();if(typeof renderProfile==='function')renderProfile();if(typeof renderChats==='function')renderChats();toast('Friend request accepted 🤝');
  }
  function handle(m){
    if(m.type==='presence-list'||m.type==='presence-update'){upsertUsers(m.users||[]);return}
    if(m.type==='friend-list'){applyFriendList(m.friends||[]);return}
    if(m.type==='friend-request'){showIncoming(m.request||{id:'fr_'+Date.now(),from:m.from,fromName:m.fromName,to:state.profile.a2lId,status:'pending',at:Date.now(),profile:m.profile});return}
    if(m.type==='friend-response'){
      const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===m.requestId);
      if(req)req.status=m.accepted?'accepted':'declined';
      if(m.accepted)applyAccepted(m.friend||{a2lId:m.from,name:m.fromName}); else {save();toast('Friend request declined');}
      return;
    }
    if(m.type==='friend-state'){applyFriendList(m.friends||[]);return}
  }
  window.a2lSocial={connect,request,accept,decline,send,sessionId,profilePayload};
  window.a2lSocialSessionId=sessionId;
  document.addEventListener('DOMContentLoaded',connect,{once:true});
  if(document.readyState!=='loading')connect();
})();
