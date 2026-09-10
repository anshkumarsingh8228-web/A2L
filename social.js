/* A2L presence + friends. One shared realtime socket; Supabase persists relationships. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const mySession=()=>window.a2lIdentity?.getSessionId?.()||'';
  const myAuth=()=>window.a2lAuth?.getUser?.()?.id||'';
  const payload=()=>({authUserId:myAuth(),a2lId:state.profile.a2lId||'',name:state.profile.displayName||'A2L user',avatar:state.profile.avatar_url||state.profile.photoData||state.profile.avatar||'🙂',ageGroup:state.profile.ageGroup||'',languages:state.profile.languages||[],interests:state.profile.interests||[],bio:state.profile.bio||'',status:state.profile.status||'Available to chat'});
  const stableId=s=>{let h=2166136261;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)}return -Math.max(1000,Math.abs(h|0));};
  const send=m=>window.a2lRealMatch?.sendRaw?.(m);
  function upsertUsers(list){
    const byKey=new Map(friends.map(f=>[String(f.userId||f.a2lId).toLowerCase(),f]));
    (list||[]).forEach(u=>{
      const uid=String(u.userId||u.a2lId||''); if(!uid||uid===mySession()||String(u.a2lId||'').toLowerCase()===String(state.profile.a2lId||'').toLowerCase())return;
      const identityKey=String(u.a2lId||u.authUserId||uid).toLowerCase(); const existingByIdentity=Array.from(byKey.values()).find(x=>String(x.a2lId||'').toLowerCase()===identityKey); const key=existingByIdentity?String(existingByIdentity.userId||uid).toLowerCase():uid.toLowerCase(); const f=existingByIdentity||byKey.get(key)||{id:stableId(uid),userId:uid};
      Object.assign(f,{userId:uid,authUserId:String(u.authUserId||f.authUserId||''),a2lId:String(u.a2lId||f.a2lId||uid),name:u.name||f.name||'A2L user',avatar:u.avatar||f.avatar||'🙂',avatar_url:u.avatar_url||f.avatar_url||u.avatar||'',ageGroup:u.ageGroup||f.ageGroup||'',languages:u.languages||f.languages||[],interests:u.interests||f.interests||[],bio:u.bio||f.bio||'',online:u.online!==false,inCall:!!u.inCall,status:u.status||f.status||'',isFriend:!!u.isFriend||!!f.isFriend});
      byKey.set(key,f);
    });
    friends.length=0; byKey.forEach(f=>friends.push(f));
    renderAll();
  }
  function mergeDirectory(rows){upsertUsers(rows||[]);}
  function refreshDirectory(){return window.a2lData?.refreshDirectory?.()||Promise.resolve([]);}
  function renderAll(){if(typeof renderPeople==='function')renderPeople();if(typeof renderProfile==='function')renderProfile();if(typeof renderChats==='function')renderChats();document.dispatchEvent(new CustomEvent('a2l:friends-updated'));}

  async function loadPersistentFriends(){
    if(!window.a2lData?.isReady?.())return;
    const rows=await window.a2lData.loadFriendships();
    const ids=[]; rows.forEach(r=>ids.push(String(r.user_a)===String(myAuth())?String(r.user_b):String(r.user_a)));
    if(!ids.length)return;
    const c=window.a2lData.client; if(!c)return;
    const {data}=await c.from('profiles').select('id,username,display_name,avatar_url,bio,age_group,interests,languages').in('id',ids);
    (data||[]).forEach(u=>upsertUsers([{userId:u.id,a2lId:u.username,name:u.display_name,avatar:u.avatar_url||'🙂',avatar_url:u.avatar_url,bio:u.bio,ageGroup:u.age_group,interests:u.interests,languages:u.languages,isFriend:true,online:false}]));
    const map=new Map(friends.filter(f=>f.isFriend).map(f=>[f.userId,f.id]));
    state.connections=Array.from(map.values());
    state.connections.forEach(id=>{const f=friends.find(x=>x.id===id);if(f){const c=state.chats[id]||{messages:[],source:'friend',ended:false,locked:false,startedAt:Date.now()};c.source='friend';c.locked=false;c.ended=false;c.livePeerId=f.userId;state.chats[id]=c;}});
    save();renderAll();
  }
  function handle(m){
    if(m.type==='presence-list'||m.type==='presence-update'){upsertUsers(m.users||[]);return}
    if(m.type==='friend-list'){(m.friends||[]).forEach(f=>{f.isFriend=true});upsertUsers(m.friends||[]);state.connections=friends.filter(f=>f.isFriend).map(f=>f.id);state.connections.forEach(id=>{const f=friends.find(x=>x.id===id);if(f){const c=state.chats[id]||{messages:[],source:'friend',ended:false,locked:false,startedAt:Date.now()};c.source='friend';c.locked=false;c.livePeerId=f.userId;state.chats[id]=c;}});save();return}
    if(m.type==='friend-request'){showIncoming(m.request||{id:'fr_'+Date.now(),from:m.from,fromName:m.fromName,to:mySession(),status:'pending',profile:m.profile});return}
    if(m.type==='friend-response'){
      const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===m.requestId); if(req)req.status=m.accepted?'accepted':'declined';
      if(m.accepted)applyAccepted(m.friend||{userId:m.from,name:m.fromName,a2lId:m.friend?.a2lId||m.from}); else {save();renderAll();toast('Friend request declined');}
      return;
    }
  }
  function applyAccepted(other){
    const uid=String(other.userId||other.id||other.a2lId||''); if(!uid)return;
    let f=friends.find(x=>x.userId===uid||String(x.a2lId).toLowerCase()===String(other.a2lId||'').toLowerCase());
    if(!f){f={id:stableId(uid),userId:uid,a2lId:String(other.a2lId||uid),name:other.name||'A2L user',avatar:other.avatar||'🙂',avatar_url:other.avatar_url||other.avatar||'',online:!!other.online,inCall:false,languages:other.languages||[],interests:other.interests||[],bio:other.bio||'',isFriend:true};friends.push(f)}
    Object.assign(f,{isFriend:true,name:other.name||f.name,avatar:other.avatar||f.avatar,avatar_url:other.avatar_url||f.avatar_url});
    state.connections=Array.from(new Set([...(state.connections||[]),f.id]));
    const c=state.chats[f.id]||{messages:[],source:'friend',ended:false,locked:false,startedAt:Date.now(),livePeerId:f.userId};c.source='friend';c.ended=false;c.locked=false;c.livePeerId=f.userId;state.chats[f.id]=c;save();
    window.a2lData?.createFriendship?.(uid);renderAll();
  }
  function showIncoming(req){
    state.connectionRequests=state.connectionRequests||{};state.connectionRequests[req.id]=req;save();window.__a2lLiveIncoming=req;
    if(typeof showConnectionRequest==='function')showConnectionRequest(req);else if($('connectionRequestText')){$('connectionRequestText').textContent=`${req.fromName||'A2L user'} wants to connect with you.`;openModal('connectionRequestModal');}
  }
  async function request(target,source='profile'){
    const f=typeof target==='object'?target:findByTarget(target);if(!f)return false;
    if(f.isFriend){toast(`${f.name} is already your friend 🤝`);return false}
    const existing=state.outgoingConnectionRequests?.[f.userId];if(existing?.status==='pending'){toast('Friend request already sent');return false}
    const req={id:'fr_'+Date.now()+'_'+Math.random().toString(36).slice(2),from:mySession(),fromAuthId:myAuth(),fromA2lId:state.profile.a2lId,fromName:state.profile.displayName,to:f.userId,toA2lId:f.a2lId,status:'pending',at:Date.now(),source,profile:payload()};
    state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};state.outgoingConnectionRequests[f.userId]=req;save();
    if(window.a2lData?.isReady?.()){const saved=await window.a2lData.saveFriendRequest({receiverId:f.userId});if(saved?.data?.id)req.dbId=saved.data.id;save();}
    if(f.online)send({type:'friend-request',to:f.userId,request:req});
    toast(f.online?'Friend request sent 🤝':'Friend request saved — they are offline');
    return true;
  }
  async function accept(req){if(!req?.from)return;const senderId=String(req.fromAuthId||req.from||'');if(window.a2lData?.isReady?.()&&senderId){await window.a2lData.acceptFriendRequest(req.dbId||'',senderId);}send({type:'friend-response',to:req.from,requestId:req.id,accepted:true});applyAccepted(req.profile||{userId:senderId,a2lId:req.fromA2lId,name:req.fromName,avatar:req.profile?.avatar});}
  async function decline(req){if(!req?.from)return;send({type:'friend-response',to:req.from,requestId:req.id,accepted:false});await window.a2lData?.updateFriendRequest?.(req.dbId||req.id,'declined');}
  function findByTarget(value){const s=String(value||'').trim().replace(/^@/,'').toLowerCase();return friends.find(f=>String(f.userId||'').toLowerCase()===s||String(f.a2lId||'').toLowerCase()===s||String(f.name||'').toLowerCase()===s);}

  window.a2lSocial={connect:()=>{if(window.a2lRealMatch?.onMessage)window.a2lRealMatch.onMessage(handle);return refreshDirectory()},request,accept,decline,sessionId:mySession,profilePayload:payload,findByTarget,mergeDirectory,refreshDirectory,loadPersistentFriends};
  window.a2lSocialSessionId=mySession;
  function init(){
    if(window.a2lRealMatch?.onMessage){window.a2lRealMatch.onMessage(handle);refreshDirectory();loadPersistentFriends();}
    else window.addEventListener('a2l:realtime-ready',()=>{window.a2lRealMatch.onMessage(handle);refreshDirectory();loadPersistentFriends();},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
