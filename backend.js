/* Alone2Lone persistent backend bridge: authenticated API + realtime notifications & chat sync. */
(function(){
  'use strict';

  function a2lIdToNumeric(id){
    let hash=0;
    const str=String(id||'').toLowerCase();
    for(let i=0;i<str.length;i++){
      hash=((hash<<5)-hash)+str.charCodeAt(i);
      hash|=0;
    }
    return Math.abs(hash)||999999;
  }

  const api=async(path,options={})=>{
    const token=window.a2lAuth?.getAccessToken?.()||'';
    const headers={'content-type':'application/json'};
    if(token)headers.authorization=`Bearer ${token}`;
    const p=(typeof state!=='undefined'&&state.profile)||{};
    if(p.a2lId)headers['x-a2l-id']=p.a2lId;

    const r=await fetch(path,{
      ...options,
      headers:{...headers,...(options.headers||{})},
      body:options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body
    });
    if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`HTTP ${r.status}`);
    return r.json();
  };

  window.a2lBackend={
    api,
    saveProfile:()=>api('/api/profile',{method:'PUT',body:{profile:state.profile}}),
    friendRequest:to=>api('/api/friend-request',{method:'POST',body:{to}}),
    report:(to,reason,context)=>api('/api/report',{method:'POST',body:{to,reason,context}}),
    block:to=>api('/api/block',{method:'POST',body:{to}}),
    friendResponse:(requestId,accepted)=>api('/api/friend-response',{method:'POST',body:{requestId,accepted}}),
    chatRequest:to=>api('/api/chat-request',{method:'POST',body:{to}}),
    chatResponse:(requestId,accepted)=>api('/api/chat-response',{method:'POST',body:{requestId,accepted}}),
    reconnect:(to,historyId)=>api('/api/reconnect',{method:'POST',body:{to,historyId}}),
    reconnectResponse:(requestId,accepted)=>api('/api/reconnect-response',{method:'POST',body:{requestId,accepted}}),
    sendMessage:(to,text)=>api('/api/message',{method:'POST',body:{to,text}}),
    notifications:()=>api('/api/notifications'),
    history:()=>api('/api/history'),
    requests:()=>api('/api/requests'),
    friends:()=>api('/api/friends'),
    discoverUsers:search=>api('/api/users'+(search?'?search='+encodeURIComponent(search):'')),
    conversation:to=>api('/api/conversation?to='+encodeURIComponent(to)),
    me:()=>api('/api/me')
  };

  async function syncIdentity(){
    try{
      const me=await window.a2lBackend.me();
      if(me){
        state.profile={
          ...state.profile,
          displayName:me.displayName||state.profile.displayName,
          a2lId:me.a2lId||state.profile.a2lId,
          avatar:me.avatar||state.profile.avatar,
          photoData:me.photoData||state.profile.photoData,
          location:me.location||state.profile.location,
          ageGroup:me.ageGroup||state.profile.ageGroup,
          bio:me.bio||state.profile.bio
        };
        save();
        if(typeof renderProfile==='function')renderProfile();
      }
    }catch(e){
      console.warn('identity sync:',e.message);
    }
  }

  function backendSaveProfile(){
    window.a2lBackend.saveProfile().catch(e=>console.warn('profile persistence:',e.message));
  }

  async function hydrateFriends(){
    try{
      const rows=await window.a2lBackend.friends();
      state.connections=state.connections||[];
      for(const r of rows||[]){
        if(!r?.a2lId)continue;
        let f=friends.find(x=>x.a2lId===r.a2lId);
        if(!f){
          const numId=a2lIdToNumeric(r.a2lId);
          f={
            id:numId,
            name:r.displayName||'Friend',
            a2lId:r.a2lId,
            avatar:r.avatar||'🙂',
            photoData:r.photoData||'',
            ageGroup:r.ageGroup||'16-17',
            languages:r.languages||['english'],
            online:true,
            interests:r.interests||[],
            bio:r.bio||''
          };
          friends.push(f);
        }
        if(!state.connections.includes(f.id)){
          state.connections.push(f.id);
        }
      }
      save();
      if(typeof renderPeople==='function')renderPeople();
      if(typeof renderProfile==='function')renderProfile();
      if(typeof renderChats==='function')renderChats();
    }catch(e){
      console.warn('hydrateFriends error:',e.message);
    }
  }

  async function hydrateRequests(){
    try{
      const data=await window.a2lBackend.requests();
      for(const r of data.friends||[]){
        if(r.to_user===state.profile.a2lId)state.connectionRequests[r.id]=r;
        else state.outgoingConnectionRequests[r.to_user]=r;
      }
      for(const r of data.chats||[]){
        state.chatRequests[r.id]=r;
      }
      for(const r of data.reconnects||[]){
        state.reconnectRequests=state.reconnectRequests||{};
        state.reconnectRequests[r.id]=r;
      }
      save();
      if(typeof renderChats==='function')renderChats();
    }catch(e){}
  }

  async function hydrateDiscoverableUsers(){
    try{
      const users=await window.a2lBackend.discoverUsers();
      for(const u of users||[]){
        if(!u?.a2lId||u.a2lId===state.profile.a2lId)continue;
        if(friends.some(f=>f.a2lId===u.a2lId))continue;
        friends.push({
          id:a2lIdToNumeric(u.a2lId),
          name:u.displayName||'A2L user',
          a2lId:u.a2lId,
          avatar:u.avatar||'🙂',
          photoData:u.photoData||'',
          ageGroup:u.ageGroup||'16-17',
          languages:u.languages||['english'],
          online:true,
          interests:u.interests||[],
          bio:u.bio||''
        });
      }
      if(typeof renderPeople==='function')renderPeople();
    }catch(e){}
  }

  async function boot(){
    await window.a2lAuthReady?.catch?.(()=>{});
    await syncIdentity();
    backendSaveProfile();
    await hydrateRequests();
    await hydrateFriends();
    await hydrateDiscoverableUsers();
    loadNotifications();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    if(typeof save==='function'&&!window.__a2lSaveWrapped){
      const oldSave=window.save;
      window.save=function(){
        oldSave();
        if(window.a2lAuth?.getAccessToken?.())backendSaveProfile();
      };
      window.__a2lSaveWrapped=true;
    }
    boot();
  });

  window.addEventListener('a2l:auth',e=>{
    if(e.detail?.session)boot();
  });

  async function loadNotifications(){
    try{
      const rows=await window.a2lBackend.notifications();
      window.__a2lNotifications=rows||[];
      const unread=(rows||[]).filter(x=>!x.read_at).length;
      if(unread)toast(`${unread} new notification${unread===1?'':'s'} 🔔`);
    }catch(e){}
  }

  // Live incoming message synchronization
  function handleIncomingChatMessage(m){
    const fromA2L=m.from||m.actorId||m.payload?.from||m.payload?.message?.sender_a2l_id;
    if(!fromA2L||fromA2L===state.profile.a2lId)return;

    let f=friends.find(x=>x.a2lId===fromA2L);
    if(!f){
      const numId=a2lIdToNumeric(fromA2L);
      f={
        id:numId,
        name:m.fromName||m.payload?.message?.sender_name||'A2L user',
        a2lId:fromA2L,
        avatar:m.avatar||'🙂',
        ageGroup:'16-17',
        languages:['english'],
        online:true,
        interests:[],
        bio:''
      };
      friends.push(f);
    }

    const fid=f.id;
    state.chats=state.chats||{};
    state.chats[fid]=state.chats[fid]||{messages:[],source:'friend',ended:false,locked:false,startedAt:Date.now()};
    const c=state.chats[fid];
    c.ended=false;
    c.locked=false;

    const text=m.text||m.payload?.message?.body||m.payload?.text||'';
    const serverId=m.serverId||m.payload?.message?.id||null;
    const at=m.at||Date.now();

    const exists=c.messages.some(existing=>
      (serverId&&existing.serverId===serverId)||
      (!existing.mine&&existing.text===text&&Math.abs(existing.at-at)<4000)
    );

    if(!exists&&text){
      c.messages.push({
        text,
        mine:false,
        at,
        status:'delivered',
        serverId
      });
      save();

      if(typeof activeChatId!=='undefined'&&activeChatId===fid&&typeof activeChatProfile!=='undefined'&&!activeChatProfile){
        if(typeof renderMessages==='function')renderMessages(fid);
      }else{
        toast(`New message from ${f.name} 💬`);
      }
      if(typeof renderChats==='function')renderChats();
    }
  }
  window.handleIncomingChatMessage=handleIncomingChatMessage;

  window.addEventListener('a2l:notification',e=>{
    const n=e.detail||{};
    const t=n.type||'';
    if(t==='message'){
      handleIncomingChatMessage(n);
    }else if(t==='friend_request'){
      toast('New friend request 🤝');
      hydrateRequests();
    }else if(t==='friend_accepted'){
      toast('Friend request accepted 🤝');
      hydrateFriends();
    }else if(t==='reconnect_request'){
      toast('Someone wants to reconnect 🔄');
      hydrateRequests();
    }else if(t==='chat_request'){
      toast('New chat request 📩');
      hydrateRequests();
    }
    loadNotifications();
  });
})();
