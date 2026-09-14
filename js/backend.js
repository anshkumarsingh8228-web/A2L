/* Alone2Lone persistent backend bridge: authenticated API + realtime notifications. */
(function(){
  'use strict';
  const api=async(path,options={})=>{
    const token=window.a2lAuth?.getAccessToken?.()||'';
    const headers={'content-type':'application/json'};
    if(token)headers.authorization=`Bearer ${token}`;
    const r=await fetch(path,{...options,headers:{...headers,...(options.headers||{})},body:options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body});
    if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||`HTTP ${r.status}`);
    return r.json();
  };

  window.a2lBackend={
    api,
    saveProfile:()=>api('/api/profile',{method:'PUT',body:{profile:state.profile}}),
    friendRequest:to=>api('/api/friend-request',{method:'POST',body:{to}}),
    friendResponse:(requestId,accepted)=>api('/api/friend-response',{method:'POST',body:{requestId,accepted}}),
    searchUsers:q=>api('/api/users/search?q='+encodeURIComponent(q)),
    report:(to,reason,context)=>api('/api/report',{method:'POST',body:{to,reason,context}}),
    block:to=>api('/api/block',{method:'POST',body:{to}}),
    chatRequest:to=>api('/api/chat-request',{method:'POST',body:{to}}),
    chatResponse:(requestId,accepted)=>api('/api/chat-response',{method:'POST',body:{requestId,accepted}}),
    reconnect:(to,historyId)=>api('/api/reconnect',{method:'POST',body:{to,historyId}}),
    reconnectResponse:(requestId,accepted)=>api('/api/reconnect-response',{method:'POST',body:{requestId,accepted}}),
    sendMessage:(to,text)=>api('/api/message',{method:'POST',body:{to,text}}),
    markConversationRead:(to,conversationId)=>api('/api/conversation/read',{method:'POST',body:{to,conversationId}}),
    clearConversation:to=>api('/api/conversation/clear',{method:'POST',body:{to}}),
    markNotificationsRead:()=>api('/api/notifications/read',{method:'POST'}),
    notifications:()=>api('/api/notifications'),
    history:()=>api('/api/history'),
    requests:()=>api('/api/requests'),
    friends:()=>api('/api/friends'),
    conversation:to=>api('/api/conversation?to='+encodeURIComponent(to)),
    me:()=>api('/api/me')
  };

  async function syncIdentity(){
    try{
      const me=await window.a2lBackend.me();
      if(me){
        state.profile={...state.profile,...me};
        save();
        if(typeof renderProfile==='function')renderProfile();
      }
    }catch(e){console.warn('identity sync:',e.message);}
  }

  function backendSaveProfile(){
    window.a2lBackend.saveProfile().catch(e=>console.warn('profile persistence:',e.message));
  }

  async function boot(){
    await window.a2lAuthReady?.catch?.(()=>{});
    if(!window.a2lAuth?.getAccessToken?.())return;
    await syncIdentity();
    backendSaveProfile();
    await hydrateFriends();
    await hydrateRequests();
    loadNotifications();
  }

  async function hydrateFriends(){
    try{
      const rows=await window.a2lBackend.friends();
      window.__a2lRealFriends=Array.isArray(rows)?rows:[];
      state.connections=state.connections||[];
      // Sync into global friends array so all components find real friends
      for(const r of window.__a2lRealFriends){
        if(!r?.a2lId)continue;
        let existing=friends.find(f=>f.a2lId===r.a2lId);
        if(!existing){
          existing={
            id:Math.floor(Math.random()*900000000)+100000000,
            name:r.displayName||r.a2lId,
            a2lId:r.a2lId,
            avatar:r.avatar||'🙂',
            photoData:r.photoData||'',
            ageGroup:r.ageGroup||'',
            languages:r.languages||['english'],
            online:!!r.online,
            interests:r.interests||[],
            bio:r.bio||'',
            isRealFriend:true,
            lastMessage:r.lastMessage||null,
            lastMessageAt:r.lastMessageAt||null,
            unreadCount:Number(r.unreadCount||0),
            conversationId:r.conversationId||null
          };
          friends.push(existing);
        }else{
          existing.name=r.displayName||existing.name;
          existing.avatar=r.avatar||existing.avatar;
          existing.photoData=r.photoData||existing.photoData;
          existing.online=!!r.online;
          existing.lastMessage=r.lastMessage!==undefined?r.lastMessage:existing.lastMessage;
          existing.lastMessageAt=r.lastMessageAt!==undefined?r.lastMessageAt:existing.lastMessageAt;
          existing.unreadCount=r.unreadCount!==undefined?Number(r.unreadCount):existing.unreadCount;
          existing.conversationId=r.conversationId||existing.conversationId;
          existing.isRealFriend=true;
        }
        if(!state.connections.includes(existing.id)) state.connections.push(existing.id);
      }
      save();
      if(typeof renderChats==='function')renderChats();
      if(typeof renderPeople==='function')renderPeople();
      if(typeof renderProfileFriends==='function')renderProfileFriends();
    }catch(e){console.warn('hydrateFriends error:',e.message);}
  }

  async function hydrateRequests(){
    try{
      const data=await window.a2lBackend.requests();
      state.connectionRequests=state.connectionRequests||{};
      state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};
      state.chatRequests=state.chatRequests||{};
      const myId=state.profile?.a2lId;
      for(const r of data.friends||[]){
        if(r.to_user===myId || r.to===myId){
          state.connectionRequests[r.id]=r;
        }else{
          state.outgoingConnectionRequests[r.to_user||r.to]=r;
        }
      }
      for(const r of data.chats||[]){
        state.chatRequests[r.id]=r;
      }
      save();
      if(typeof renderChats==='function')renderChats();
      updateRequestsTabBadge();
    }catch(e){console.warn('hydrateRequests error:',e.message);}
  }

  function updateRequestsTabBadge(){
    const pendingCount=Object.values(state.connectionRequests||{}).filter(r=>r&&r.status==='pending').length;
    const reqTab=document.querySelector('[data-chat-category="requests"]');
    if(reqTab){
      reqTab.innerHTML=pendingCount>0?`📩 Requests <span class="tab-badge">${pendingCount}</span>`:`📩 Requests`;
    }
  }
  window.updateRequestsTabBadge=updateRequestsTabBadge;

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

  // Handle incoming WebSocket messages and notifications
  window.addEventListener('a2l:ws-message',e=>{
    const m=e.detail||{};
    if(m.type==='chat-message'){
      handleIncomingChatMessage(m);
    }else if(m.type==='messages-read'){
      handleMessagesReadEvent(m);
    }else if(m.type==='messages-cleared'){
      handleMessagesClearedEvent(m);
    }else if(m.type==='friend-request-received'){
      if(m.request){
        state.connectionRequests=state.connectionRequests||{};
        state.connectionRequests[m.request.id]=m.request;
        save();
        updateRequestsTabBadge();
        if(typeof renderChats==='function')renderChats();
        toast(`New friend request from ${m.request.fromName||'A2L user'} 🤝`);
      }
    }else if(m.type==='friend-accepted'){
      hydrateFriends().then(()=>{
        toast(`${m.friend?.displayName||'Friend'} accepted your friend request! 🎉`);
      });
    }
  });

  function handleIncomingChatMessage(m){
    const senderA2L=m.from||m.message?.sender_id;
    const text=m.message?.body||'';
    const activePeerA2L=(typeof activeChatId==='string')?activeChatId:(friends.find(f=>f.id===activeChatId)?.a2lId);
    const isCurrentChatOpen=(document.getElementById("chat")?.classList.contains("active") && activePeerA2L===senderA2L);

    // Update friend record's lastMessage
    const f=friends.find(x=>x.a2lId===senderA2L);
    if(f){
      f.lastMessage=text;
      f.lastMessageAt=new Date().toISOString();
      if(!isCurrentChatOpen){
        f.unreadCount=(f.unreadCount||0)+1;
      }
    }

    // Un-delete conversation if it was previously hidden/deleted
    if(state.deletedChats&&state.deletedChats.length){
      state.deletedChats=state.deletedChats.filter(x=>x!==senderA2L&&x!==f?.id&&x!==String(f?.id));
    }

    // Update conversation in state.chats
    const targetKey=f?f.id:senderA2L;
    state.chats[targetKey]=state.chats[targetKey]||{messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()};
    const incomingMsg={
      id:m.message?.id,
      text,
      mine:false,
      at:m.message?.at||Date.now(),
      status:isCurrentChatOpen?'read':'delivered'
    };
    state.chats[targetKey].messages.push(incomingMsg);
    save();

    if(isCurrentChatOpen){
      if(typeof renderMessages==='function')renderMessages(targetKey);
      // Mark as read immediately since user is actively viewing
      window.a2lBackend.markConversationRead(senderA2L,m.conversationId).catch(()=>{});
    }else{
      if(typeof renderChats==='function')renderChats();
      toast(`💬 ${f?.name||'New message'}: ${text.slice(0,35)}`);
    }
  }

  function handleMessagesReadEvent(m){
    const readerA2L=m.by;
    const f=friends.find(x=>x.a2lId===readerA2L);
    const targetKey=f?f.id:readerA2L;
    const c=state.chats[targetKey];
    if(c&&Array.isArray(c.messages)){
      c.messages.forEach(msg=>{
        if(msg.mine)msg.status='read';
      });
      save();
      const activePeerA2L=(typeof activeChatId==='string')?activeChatId:(friends.find(x=>x.id===activeChatId)?.a2lId);
      if(activePeerA2L===readerA2L && typeof renderMessages==='function'){
        renderMessages(targetKey);
      }
    }
  }

  function handleMessagesClearedEvent(m){
    const senderA2L=m.by;
    const f=friends.find(x=>x.a2lId===senderA2L);
    const targetKey=f?f.id:senderA2L;
    if(f){
      f.lastMessage=null;
      f.lastMessageAt=null;
      f.unreadCount=0;
    }
    if(state.chats[targetKey]){
      state.chats[targetKey].messages=[];
    }
    save();
    const activePeerA2L=(typeof activeChatId==='string')?activeChatId:(friends.find(x=>x.id===activeChatId)?.a2lId);
    if(activePeerA2L===senderA2L){
      if(typeof renderMessages==='function')renderMessages(targetKey);
      toast("Chat messages were cleared");
    }
    if(typeof renderChats==='function')renderChats();
  }

  window.addEventListener('a2l:notification',e=>{
    const n=e.detail||{};
    const t=n.type||'';
    if(t==='message'){
      // Notification handled in ws-message; refresh state
      hydrateFriends();
    }else if(t==='friend_request'){
      hydrateRequests();
      toast('New friend request 🤝');
    }else if(t==='friend_accepted'){
      hydrateFriends();
      toast('Friend request accepted! 🎉');
    }else if(t==='reconnect_request'){
      toast('Someone wants to reconnect 🔄');
    }else if(t==='chat_request'){
      hydrateRequests();
      toast('New chat request 📩');
    }
    loadNotifications();
  });

  window.a2lHydrateFriends=hydrateFriends;
  window.a2lHydrateRequests=hydrateRequests;
})();
