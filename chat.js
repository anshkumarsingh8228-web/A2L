/* Alone2Lone chat, history, profile actions and wallpapers. */

function chatAccess(c){
  if(!c) return {allowed:false,reason:"missing"};
  if(state.premium) return {allowed:true,reason:"premium"};
  if(c.ended===true) return {allowed:false,reason:"ended"};
  if(c.locked===true) return {allowed:false,reason:"locked"};
  if(c.source==="quick") return {allowed:true,reason:"quick-free"};
  return {allowed:false,reason:"premium-required"};
}
function showPremiumGate(){
  toast("Unlock Premium to Access");
  setTimeout(()=>go("premium"),550);
}

let chatSelectionMode=false;
const selectedChatIds=new Set();
let chatLongPressTimer=null;
let chatLongPressTriggered=false;

function clearChatSelection(){
  selectedChatIds.clear();
  chatSelectionMode=false;
  $("chatSelectionToolbar")?.classList.remove("show");
  $("chatList")?.classList.remove("chat-selection-mode");
  qsa("[data-chat-select]").forEach(row=>{
    row.classList.remove("chat-selected");
    const check=row.querySelector(".chat-select-check");
    if(check){check.classList.remove("checked");check.textContent="";}
  });
  updateChatSelectionUI();
}

function updateChatSelectionUI(){
  const count=selectedChatIds.size;
  const countEl=$("chatSelectionCount");
  if(countEl) countEl.textContent=`${count} selected`;
  $("chatSelectionDelete")?.toggleAttribute("disabled",count===0);
}

function enterChatSelection(id){
  chatSelectionMode=true;
  $("chatSelectionToolbar")?.classList.add("show");
  $("chatList")?.classList.add("chat-selection-mode");
  toggleChatSelection(id);
}

function toggleChatSelection(id){
  if(selectedChatIds.has(id)) selectedChatIds.delete(id);
  else selectedChatIds.add(id);
  const row=document.querySelector(`[data-chat-select="${id}"]`);
  if(row){
    const selected=selectedChatIds.has(id);
    row.classList.toggle("chat-selected",selected);
    const check=row.querySelector(".chat-select-check");
    if(check){check.classList.toggle("checked",selected);check.textContent=selected?"✓":"";}
  }
  if(selectedChatIds.size===0) clearChatSelection();
  else updateChatSelectionUI();
}

function setupChatSelection(){
  qsa("[data-chat-select]").forEach(row=>{
    const id=Number(row.dataset.chatSelect);

    row.onclick=()=>{
      if(chatLongPressTriggered){chatLongPressTriggered=false;return;}
      if(chatSelectionMode){toggleChatSelection(id);return;}

      const c=state.chats[id]||{};
      if(state.premium){
        c.source=c.source||"suggested";
        state.chats[id]=c;normalizeChatEntitlements();
        if(chatAccess(c).allowed){save();openChat(id);return;}
        openProfile(id);return;
      }
      if(!chatAccess(c).allowed){
        openProfile(id);toast("Unlock Premium to access this chat");return;
      }
      openChat(id);
    };

    const startPress=e=>{
      if(e.target.closest("button,a,input")) return;
      chatLongPressTriggered=false;
      clearTimeout(chatLongPressTimer);
      chatLongPressTimer=setTimeout(()=>{
        chatLongPressTriggered=true;
        if(!chatSelectionMode) enterChatSelection(id);
        else toggleChatSelection(id);
        if(navigator.vibrate) navigator.vibrate(35);
      },550);
    };
    const cancelPress=()=>{
      clearTimeout(chatLongPressTimer);
      chatLongPressTimer=null;
    };

    row.addEventListener("pointerdown",startPress);
    row.addEventListener("pointerup",cancelPress);
    row.addEventListener("pointercancel",cancelPress);
    row.addEventListener("pointerleave",cancelPress);
    row.addEventListener("contextmenu",e=>e.preventDefault());
  });
}

function deleteSelectedChats(){
  const ids=Array.from(selectedChatIds).filter(id=>state.chats[id]);
  if(!ids.length){toast("Select at least one chat");return;}
  const label=ids.length===1?"this chat":`${ids.length} chats`;
  if(!confirm(`Delete ${label}?`)) return;
  ids.forEach(id=>{
    delete state.chats[id];
    if(activeChatId===id) activeChatId=null;
  });
  save();
  clearChatSelection();
  renderChats();
  renderHistory();
  toast(ids.length===1?"Chat deleted 🗑️":"Chats deleted 🗑️");
}

function initChatSelectionControls(){
  $("chatSelectionCancel")?.addEventListener("click",clearChatSelection);
  $("chatSelectionDelete")?.addEventListener("click",deleteSelectedChats);
}
function initChatCategoryControls(){
  qsa("[data-chat-category]").forEach(b=>{
    b.addEventListener("click",()=>setChatCategory(b.dataset.chatCategory));
  });
  $("newFriendChat")?.addEventListener("click",openNewFriendChatPicker);
}

let chatCategory="friends";

function chatCategoryOf(id){
  return (state.connections||[]).map(Number).includes(Number(id))?"friends":"strangers";
}

function renderChatRequests(){
  const reqs=Object.values(state.chatRequests||{}).filter(r=>r&&r.status==="pending");
  if(!reqs.length){
    return '<div class="card empty chat-empty-state">No chat requests yet. 📩</div>';
  }
  return `<div class="chat-request-list">${reqs.map(r=>{
    const id=Number(r.fromId||r.fromUserId||0);
    const f=friends.find(x=>x.id===id);
    const name=f?.name||r.fromName||"A2L user";
    const avatar=f?.avatar||r.avatar||"🙂";
    return `<div class="chat-request-row">
      <div class="avatar">${avatar}</div>
      <div class="preview"><b>${escapeHTML(name)}</b><span class="muted">Wants to chat with you</span></div>
      <div class="chat-request-actions">
        <button class="secondary" type="button" data-chat-request-decline="${escapeHTML(r.id)}">Decline</button>
        <button class="primary" type="button" data-chat-request-accept="${escapeHTML(r.id)}">Accept</button>
      </div>
    </div>`;
  }).join("")}</div>`;
}

async function acceptChatRequest(requestId){
  const r=state.chatRequests?.[requestId];
  if(!r)return;
  const fromA2l=r.from_user||r.from||r.fromA2lId;
  const f=fromA2l?friends.find(x=>x.a2lId===fromA2l):friends.find(x=>Number(x.id)===Number(r.fromId||r.fromUserId));
  const id=f?.id;
  try{await window.a2lBackend?.chatResponse?.(requestId,true);}catch(e){toast(e.message||"Could not accept chat request");return;}
  if(id){
    state.connections=state.connections||[];
    if(!state.connections.includes(id))state.connections.push(id);
    state.chats[id]=state.chats[id]||{messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()};
    state.chats[id].source="friend";state.chats[id].ended=false;state.chats[id].locked=false;save();
  }
  renderChats();toast("Chat request accepted");if(id)openChat(id);
}

async function declineChatRequest(requestId){
  const r=state.chatRequests?.[requestId];if(!r)return;
  try{await window.a2lBackend?.chatResponse?.(requestId,false);}catch(e){toast(e.message||"Could not decline chat request");return;}
  r.status="declined";r.declinedAt=Date.now();save();renderChats();toast("Chat request declined");
}

async function requestChatAccess(id){
  const f=friends.find(x=>Number(x.id)===Number(id));if(!f)return;
  if((state.connections||[]).map(Number).includes(Number(id))){const c=state.chats[id]||{messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()};c.source="friend";c.ended=false;c.locked=false;state.chats[id]=c;save();openChat(id);return;}
  state.outgoingChatRequests=state.outgoingChatRequests||{};
  if(state.outgoingChatRequests[f.a2lId]?.status==="pending"){toast("Chat request already sent");return;}
  try{const r=await window.a2lBackend?.chatRequest?.(f.a2lId);state.outgoingChatRequests[f.a2lId]={...r,to:f.a2lId,toName:f.name,status:"pending"};save();toast("Chat request sent 📩");}catch(e){toast(e.message||"Could not send chat request");}
}

function setChatCategory(category){
  chatCategory=category;
  qsa("[data-chat-category]").forEach(b=>{
    const active=b.dataset.chatCategory===category;
    b.classList.toggle("active",active);
    b.setAttribute("aria-selected",String(active));
  });
  renderChats();
}

function renderChats(){
  qsa("[data-chat-category]").forEach(b=>{
    const active=b.dataset.chatCategory===chatCategory;
    b.classList.toggle("active",active);
    b.setAttribute("aria-selected",String(active));
  });

  if(chatCategory==="requests"){
    $("chatList").innerHTML=renderChatRequests();
    $("newFriendChat")?.classList.add("hidden");
    clearChatSelection();
    qsa("[data-chat-request-accept]").forEach(b=>b.onclick=()=>acceptChatRequest(b.dataset.chatRequestAccept));
    qsa("[data-chat-request-decline]").forEach(b=>b.onclick=()=>declineChatRequest(b.dataset.chatRequestDecline));
    return;
  }

  $("newFriendChat")?.classList.toggle("hidden",chatCategory!=="friends");
  const ids=Object.keys(state.chats).map(Number).filter(id=>state.chats[id]&&chatCategoryOf(id)===chatCategory);
  $("chatList").innerHTML=ids.length?ids.map(id=>{
    const f=friends.find(x=>x.id===id); const c=state.chats[id]||{}; const msgs=c.messages||[]; const last=msgs[msgs.length-1];
    const access=chatAccess(c);
    const locked=!access.allowed;
    return `<div class="chatrow" data-open-chat="${id}" data-chat-select="${id}">
  <div class="chat-select-check" aria-hidden="true"></div>
  <div class="avatar chat-profile-avatar" data-open-profile="${id}" role="button" tabindex="0" title="Open profile" aria-label="Open ${escapeHTML(f?.name||"Friend")} profile">${f?.avatar||"🙂"}</div>
  <div class="preview"><b>${escapeHTML(f?.name||"Friend")}</b><span class="muted">${locked?"🔒 Chat locked":safeText(last?.text||"")}</span></div>
  <div class="chat-actions"><span>${locked?"💬":"›"}</span></div>
</div>`;
  }).join(""):`<div class="card empty chat-empty-state">${chatCategory==="friends"?"No friend chats yet. Tap ＋ to start one.":"No stranger chats yet. 🌐"}</div>`;

  setupChatSelection();

  qsa("[data-open-chat]").forEach(x=>x.onclick=()=>{
    const id=Number(x.dataset.openChat), c=state.chats[id]||{};
    if(state.premium){
      c.source=c.source||"suggested";
      normalizeChatEntitlements();
      if(chatAccess(c).allowed){save();openChat(id);return;}
      openProfile(id);return;
    }
    if(!chatAccess(c).allowed){
      openProfile(id);toast("Unlock Premium to access this chat");return;
    }
    openChat(id);
  });

  qsa("[data-open-profile]").forEach(avatar=>{
    const open=()=>{
      const id=Number(avatar.dataset.openProfile);
      openProfile(id);
    };
    avatar.onclick=e=>{e.preventDefault();e.stopPropagation();open();};
    avatar.onpointerdown=e=>e.stopPropagation();
    avatar.onpointerup=e=>e.stopPropagation();
    avatar.oncontextmenu=e=>e.stopPropagation();
    avatar.onkeydown=e=>{
      if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();open();}
    };
  });
}

function openNewFriendChatPicker(){
  const modal=$("newFriendChatModal"),list=$("newFriendChatList");
  if(!modal||!list)return;
  const ids=(state.connections||[]).map(Number).filter(id=>friends.some(f=>f.id===id));
  list.innerHTML=ids.length?ids.map(id=>{
    const f=friends.find(x=>x.id===id);
    return `<button class="new-friend-chat-row" type="button" data-start-friend-chat="${id}">
      <span class="avatar">${f?.avatar||"🙂"}</span>
      <span class="grow"><b>${escapeHTML(f?.name||"Friend")}</b><small>${f?.online?"Online":"Offline"}</small></span>
      <span>›</span>
    </button>`;
  }).join(""):'<div class="card empty">No friends yet. Add friends first to start a new chat.</div>';
  modal.classList.add("show");modal.setAttribute("aria-hidden","false");
  qsa("[data-start-friend-chat]").forEach(b=>b.onclick=()=>{
    const id=Number(b.dataset.startFriendChat);
    closeModal("newFriendChatModal");
    state.chats[id]=state.chats[id]||{messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()};
    state.chats[id].source="friend";state.chats[id].ended=false;state.chats[id].locked=false;
    save();chatCategory="friends";renderChats();
    if(state.premium)openChat(id);else openProfile(id);
  });
}

function renderHistory(){
  const ids=Object.keys(state.chats).map(Number).filter(id=>state.chats[id]);
  $("historyList").innerHTML=ids.length?ids.map(id=>{
    const f=friends.find(x=>x.id===id), c=state.chats[id]||{}, msgs=c.messages||[], last=msgs[msgs.length-1];
    return `<div class="chatrow" data-open-history="${id}"><div class="avatar">${f?.avatar||"🙂"}</div><div class="preview"><b>${escapeHTML(f?.name||"Friend")}</b><span class="muted">${c.ended?"🔒 Chat ended":safeText(last?.text||"")}</span><span class="muted">${msgs.length} message(s)</span></div><span>${c.ended?"💬":"›"}</span></div>`;
  }).join(""):`<div class="card empty">No chat history yet.</div>`;
  qsa("[data-open-history]").forEach(x=>x.onclick=()=>{
    const id=Number(x.dataset.openHistory);
    const c=state.chats[id]||null;
    if(state.premium && c){
      c.locked=false;
      c.ended=false;
      c.source=c.source||"suggested";
      state.chats[id]=c;
      save();
      openChat(id);
      return;
    }
    openProfile(id);
  });
}
function animateLike(){const layer=$("likeBurst");if(!layer)return;layer.innerHTML='<div class="a2l-like-flash"></div>';for(let i=0;i<9;i++){const h=document.createElement("span");h.className="a2l-heart-float";h.textContent=i%3===0?"❤️":i%3===1?"💗":"💕";h.style.left=(20+Math.random()*60)+"%";h.style.top=(48+Math.random()*18)+"%";h.style.setProperty("--dx",((Math.random()-.5)*180)+"px");h.style.setProperty("--dy",((Math.random()-.5)*100)+"px");h.style.setProperty("--rot",((Math.random()-.5)*35)+"deg");h.style.animationDelay=(Math.random()*.16)+"s";layer.appendChild(h)}setTimeout(()=>layer.innerHTML="",1350)}
function refreshChatActionStates(id){const f=friends.find(x=>x.id===id),connected=(state.connections||[]).includes(id),pending=!!(f&&state.outgoingConnectionRequests?.[f.a2lId]?.status==="pending");const c=$("actionConnect");if(c)c.innerHTML=connected?"🤝 Connected<small>You’re in each other’s circle</small>":pending?"⏳ Request sent<small>Waiting for their response</small>":"🤝 Connect<small>Send a connection request</small>";const r=$("actionReconnect");if(r)r.hidden=connected||!state.memories?.[id]}
function likePerson(id){const f=friends.find(x=>x.id===id);if(!f)return;state.likedByMe=state.likedByMe||{};if(state.likedByMe[id])return;state.likes[id]=Number(state.likes[id]||0)+1;state.likedByMe[id]=true;save();renderPeople();renderProfile();if(activeChatId===id)refreshChatActionStates(id);animateLike();const btn=$("chatLikePerson");if(btn){btn.classList.remove("pulse");void btn.offsetWidth;btn.classList.add("pulse")}}
function requestConnection(id){const f=friends.find(x=>x.id===id);if(!f)return;if(!state.premium){showPremiumGate();return;}state.connectionRequests=state.connectionRequests||{};state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};if((state.connections||[]).includes(id)){if(!confirm(`Remove ${f.name} from your circle?`))return;state.connections=state.connections.filter(x=>x!==id);save();refreshChatActionStates(id);renderProfile();toast(`${f.name} removed from your circle`);return}if(state.outgoingConnectionRequests[f.a2lId]?.status==="pending"){toast("Friend request already sent");return}const req={id:"cr_"+Date.now()+"_"+Math.random().toString(36).slice(2),from:state.profile.a2lId,fromName:state.profile.displayName,to:f.a2lId,toId:id,status:"pending",at:Date.now()};state.outgoingConnectionRequests[f.a2lId]=req;save();window.a2lBackend?.friendRequest(f.a2lId).then(r=>{req.id=r.id||req.id;save()}).catch(e=>console.warn('friend request persistence:',e.message));refreshChatActionStates(id);toast("Friend request sent")}
function respondConnection(accepted){const reqId=window.__incomingConnectionId,req=state.connectionRequests?.[reqId];if(!req)return;req.status=accepted?"accepted":"declined";save();window.a2lBackend?.friendResponse(req.id,accepted).catch(e=>console.warn('friend response persistence:',e.message));closeModal("connectionRequestModal");if(accepted){const f=friends.find(x=>x.a2lId===req.from);if(f&&!state.connections.includes(f.id))state.connections.push(f.id);save();renderProfile();toast("Friend request accepted")}else toast("Connection request declined")}
function showConnectionRequest(req){window.__incomingConnectionId=req.id;$("connectionRequestText").textContent=`${req.fromName} wants to connect with you.`;openModal("connectionRequestModal")}
async function blockPerson(id){
  const f=friends.find(x=>x.id===id);if(!f)return;
  if(!confirm(`Block ${f.name}? They will disappear from discovery and cannot call or message you.`))return;
  try{await window.a2lBackend?.block?.(f.a2lId);if(!state.blocked.includes(id))state.blocked.push(id);delete state.chats[id];state.connections=(state.connections||[]).filter(x=>x!==id);save();activeChatId=null;activeChatProfile=false;go('home');renderPeople();toast(`${f.name} blocked 🛡️`)}catch(e){toast(e.message||'Could not block user')}
}
async function reportPerson(id){
  const f=friends.find(x=>x.id===id);if(!f)return;
  const reason=prompt(`Report ${f.name}. What is the reason?`,"Inappropriate behaviour");if(reason===null)return;
  try{await window.a2lBackend?.report?.(f.a2lId,reason,'chat');toast("Report submitted for review 🛡️")}catch(e){toast(e.message||'Could not submit report')}
}
function openProfile(id){
  const f=friends.find(x=>x.id===id);if(!f)return;
  profileReturnPage=(document.getElementById("chat")?.classList.contains("active") && activeChatId===id && !activeChatProfile)?"chat":"home";
  profileReturnChatId=profileReturnPage==="chat"?id:null;
  activeChatProfile=true;activeChatId=id;
  let c=state.chats[id]||null;
  if(state.premium && (!c || c.ended!==true)){
    c=c||{messages:[],source:"suggested",ended:false,locked:false,startedAt:Date.now()};c.source=c.source||"suggested";c.ended=false;c.locked=false;state.chats[id]=c;save();
  }
  const access=c?chatAccess(c):{allowed:false};const canChat=access.allowed;
  const liked=!!(state.likedByMe&&state.likedByMe[id]);const connected=(state.connections||[]).includes(id);const likes=Number(state.likes[id]||0);
  const chatIcon="",iconClass="";
  $('chatStage').innerHTML=`<div class="card"><div class="profileHead profileHead-chat"><button class="profile-back-btn" id="profileBackBtn" type="button" aria-label="Back">‹</button><div class="profileHead-main"><div class="bigavatar">${f.avatar}</div><div><h2 style="margin:0">${escapeHTML(f.name)}</h2><p class="muted" style="margin:5px 0 0">${f.online?"🟢 Online":"⚪ Offline"} · ${escapeHTML(f.interests.join(" · "))}</p></div></div><button class="chat-unified profile-inline-chat" id="profileChatBtn"><span>Chat</span></button></div><div class="a2l-profile-actions"><button class="secondary a2l-like-display" id="profileLikeBtn" type="button" aria-label="Like ${escapeHTML(f.name)}">❤️ ${likes.toLocaleString()} likes</button><button class="secondary a2l-connect-btn ${connected?"connected":""}" id="profileConnectBtn" type="button">${connected?"🤝 Connected":state.outgoingConnectionRequests?.[f.a2lId]?.status==="pending"?"Friend request sent":"＋ Add Friend"}</button></div><div class="a2l-safety-row"><button class="secondary" id="profileReportBtn">⚑ Report</button><button class="danger" id="profileBlockBtn">⛔ Block</button></div></div>
  <div class="card"><h3 style="margin-top:0">About ${escapeHTML(f.name)}</h3><p class="muted">${escapeHTML(f.bio)}</p><div class="chips">${f.interests.map(x=>`<span class="chip">${escapeHTML(x)}</span>`).join("")}</div><div class="profile-info-compact"><div><span class="profile-info-label">Language</span><strong>${f.languages?.includes("english")&&f.languages?.includes("hindi")?"English + Hindi":f.languages?.includes("english")?"English":"Hindi"}</strong></div><div><span class="profile-info-label">Age group</span><strong>${escapeHTML(f.ageGroup||"—")}</strong></div></div></div>`;
  go("chat");
  $("profileBackBtn").onclick=()=>{
    const returnToChat=profileReturnPage==="chat"&&profileReturnChatId===id;
    activeChatProfile=false;
    if(returnToChat){ openChat(id); }
    else { activeChatId=null; go("home"); }
  };
  $('profileLikeBtn').onclick=()=>likePerson(id);
  $('profileConnectBtn').onclick=()=>requestConnection(id);
  $('profileReportBtn').onclick=()=>reportPerson(id);
  $('profileBlockBtn').onclick=()=>blockPerson(id);
  $('profileChatBtn').onclick=()=>{if((state.connections||[]).map(Number).includes(Number(id))){const current=state.chats[id]||{messages:[],source:"friend",ended:false,locked:false,startedAt:Date.now()};current.source="friend";current.ended=false;current.locked=false;state.chats[id]=current;save();openChat(id);return;}requestChatAccess(id);};
}

function openChat(id){
  const f=friends.find(x=>x.id===id), c=state.chats[id];if(!f||!c)return;
  activeChatProfile=false;
  activeChatId=id;
  normalizeChatEntitlements();
  if(!chatAccess(c).allowed){showPremiumGate();return;}
  $("chatStage").innerHTML=`<div class="chat-wa-header">
    <button class="chat-wa-back" id="chatHeaderBack" aria-label="Back to Chats">‹</button>
    <div class="chat-wa-avatar chat-header-profile-target" data-chat-header-profile="1" role="button" tabindex="0" title="Open profile" aria-label="Open profile">${f.avatar}</div>
    <div class="chat-wa-info chat-header-profile-target" data-chat-header-profile="1" role="button" tabindex="0" title="Open profile">
      <b>${escapeHTML(f.name)}</b>
      <div class="chat-wa-status">${f.online?"Online":"Offline"} · ${escapeHTML(f.interests.join(" · "))}</div>
    </div>
    <div class="chat-wa-actions">
      <button class="chat-wa-action" id="chatVoiceCall" aria-label="Voice call" title="Voice call">📞</button>
      <button class="chat-wa-action" id="chatVideoCall" aria-label="Video call" title="Video call">📹</button>
      <button class="chat-wa-action chat-wa-end" id="endChat" aria-label="Chat options" title="Chat options">⋮</button>
    </div>
    <div class="chat-wa-menu" id="chatWaMenu" role="menu" aria-label="Chat options">
      <button id="chatWallpaperBtn" role="menuitem">🎨 Wallpaper</button>
      <button id="chatClearMessages" role="menuitem">🧹 Clear messages</button>
      <button id="chatEndFromMenu" class="menu-danger" role="menuitem">⛔ End chat</button>
    </div>
  </div>
  <div class="chatbox"><div class="messages" id="messages"></div><div class="chat-warning" id="chatWarning" role="alert"></div><div class="chat-quick-tools"><button class="secondary" id="chatPlayGame" type="button">🎮 Play</button><button class="secondary chat-more-btn" id="chatMoreActions" type="button">More</button></div><div class="composer"><div class="composer-input-wrap"><input id="messageInput" maxlength="500" placeholder="Write a message…" autocomplete="off"><button class="composer-emoji-btn" id="composerEmoji" type="button" aria-label="Open emoji reactions">😊</button><div class="composer-emoji-picker" id="composerEmojiPicker" hidden></div></div><button class="primary" id="sendMessage" type="button">Send</button></div></div>`;
  // Hydrate the conversation from the server so reloads/devices keep message history.
  window.a2lBackend?.conversation?.(f.a2lId).then(data=>{
    if(!data)return;
    const serverMsgs = (data.messages||[]).map(m=>({
      serverId:m.id,
      text:m.body,
      mine:typeof m.mine==='boolean'?m.mine:(m.sender_a2l_id?m.sender_a2l_id===state.profile.a2lId:m.sender_id===state.profile.a2lId),
      at:new Date(m.created_at).getTime(),
      status:m.read_at?'read':m.delivered_at?'delivered':'sent'
    }));
    const existing = c.messages || [];
    for (const sm of serverMsgs) {
      const match = existing.find(em => em.serverId === sm.serverId || (em.mine === sm.mine && em.text === sm.text && Math.abs(em.at - sm.at) < 5000));
      if (!match) {
        existing.push(sm);
      } else {
        match.serverId = sm.serverId;
        match.status = sm.status;
      }
    }
    c.messages = existing.sort((a,b) => a.at - b.at);
    c.serverConversationId=data.id||null;save();renderMessages(id);
  }).catch(()=>{});

  // Directly bind the actual chat header controls to this friend's profile.
  // This avoids interference from any parent chat-row handlers.
  const chatHeaderAvatar = $("chatStage").querySelector(".chat-wa-avatar");
  const chatHeaderInfo = $("chatStage").querySelector(".chat-wa-info");
  const openHeaderProfile = e => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    openProfile(id);
  };
  if(chatHeaderAvatar){
    chatHeaderAvatar.style.cursor = "pointer";
    chatHeaderAvatar.onclick = openHeaderProfile;
    chatHeaderAvatar.onkeydown = e => {
      if(e.key==="Enter" || e.key===" "){ openHeaderProfile(e); }
    };
  }
  if(chatHeaderInfo){
    chatHeaderInfo.style.cursor = "pointer";
    chatHeaderInfo.onclick = openHeaderProfile;
    chatHeaderInfo.onkeydown = e => {
      if(e.key==="Enter" || e.key===" "){ openHeaderProfile(e); }
    };
  }
  go("chat");renderMessages(id);applyChatWallpaper(id);
  qsa("[data-say-hello]").forEach(b=>b.onclick=()=>{
    const input=$("messageInput");
    if(input){input.value="Hey "+(f.name||"there")+"! 👋";sendMessage(id);}
  });
  const reactionOptions=["❤️","😂","😮","👍","👏","🔥","🎉"];
  const reactionPicker=$("composerEmojiPicker");
  const reactionButton=$("composerEmoji");
  if(reactionPicker&&reactionButton){
    reactionPicker.innerHTML=reactionOptions.map(e=>`<button type="button" class="composer-emoji-option" aria-label="React ${e}">${e}</button>`).join("");
    reactionButton.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();});
    reactionButton.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      reactionPicker.hidden=!reactionPicker.hidden;
      $("messageInput")?.focus({preventScroll:true});
    };
    qsa(".composer-emoji-option").forEach(b=>{b.addEventListener("pointerdown",e=>e.preventDefault());b.onclick=()=>{const emoji=b.textContent.trim();showChatReaction(emoji);reactionPicker.hidden=true;const input=$("messageInput");if(input){input.value=emoji;sendMessage(id);input.focus({preventScroll:true});}};});
  }
  $("chatPlayGame").onclick=()=>openPlayRequest(id);
  $("chatMoreActions").onclick=()=>{refreshChatActionStates(id);$("chatActionsModal").dataset.target=id;openModal("chatActionsModal")};
  $("actionConnect").onclick=()=>{closeModal("chatActionsModal");requestConnection(id)};
  $("actionReconnect").onclick=()=>{closeModal("chatActionsModal");reconnectPerson(id)};
  $("actionChallenge").onclick=()=>{closeModal("chatActionsModal");showChallengeFromChat(id)};
  $("actionSurprise").onclick=()=>{closeModal("chatActionsModal");surpriseForChat(id)};
  $("actionCulture").onclick=()=>{closeModal("chatActionsModal");startCulturePrompt(id)};
  $("actionProfile").onclick=()=>{closeModal("chatActionsModal");openProfile(id)};
  $("actionReport").onclick=()=>{closeModal("chatActionsModal");reportPerson(id)};
  $("actionBlock").onclick=()=>{closeModal("chatActionsModal");blockPerson(id)};
  refreshChatActionStates(id);
  const sendBtn=$("sendMessage"), input=$("messageInput");
  let pointerSendHandled=false;
  const send=()=>{
    sendMessage(id);
    requestAnimationFrame(()=>{
      const el=$("messageInput");
      if(el){ el.focus({preventScroll:true}); }
    });
  };
  sendBtn.type="button";
  // Mobile-safe send: handle the pointer before the button can steal focus,
  // while keeping a click fallback for keyboard/accessibility activation.
  sendBtn.addEventListener("pointerdown",e=>{
    e.preventDefault();
    pointerSendHandled=true;
    send();
  });
  sendBtn.onclick=()=>{
    if(pointerSendHandled){ pointerSendHandled=false; return; }
    send();
  };
  const updateChatWarning=()=>{
    const el=$("chatWarning");
    if(!el)return;
    const value=input.value;
    let hasPhone=phone10.test(value);
    phone10.lastIndex=0;
    let hasAbuse=banned.some(r=>r.test(value));
    if(hasPhone&&hasAbuse) el.textContent="⚠️ Warning: Phone numbers and abusive language are not allowed in chat.";
    else if(hasPhone) el.textContent="⚠️ Warning: Phone numbers are not allowed in chat.";
    else if(hasAbuse) el.textContent="⚠️ Warning: Abusive language is not allowed in chat.";
    else el.textContent="";
    el.classList.toggle("show",hasPhone||hasAbuse);
  };
  input.addEventListener("input",updateChatWarning);
  input.addEventListener("focus",()=>{
    // Keep focus inside the app; never resize or scroll the document for the keyboard.
  });
  input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
  const chatMenu=$("chatWaMenu");
  $("endChat").onclick=e=>{e.stopPropagation();chatMenu.classList.toggle("open")};
  $("chatVideoCall")?.addEventListener("click",()=>window.a2lCall?.startMatch("video",id,"call"));
  $("chatVoiceCall")?.addEventListener("click",()=>window.a2lCall?.startMatch("voice",id,"call"));

  $("chatWallpaperBtn").onclick=()=>{chatMenu.classList.remove("open");openWallpaperPicker(id)};
  $("chatClearMessages").onclick=()=>{chatMenu.classList.remove("open");if(confirm("Clear all messages in this chat?")){state.chats[id].messages=[];save();renderMessages(id);toast("Messages cleared 🧹")}};
  $("chatEndFromMenu").onclick=()=>{chatMenu.classList.remove("open");requestEndChat()};
  $("chatWallpaperClose").onclick=()=>closeWallpaperPicker(id,false);
  $("chatWallpaperCancel").onclick=()=>closeWallpaperPicker(id,false);
  $("chatWallpaperConfirm").onclick=()=>closeWallpaperPicker(id,true);
  $("chatHeaderBack").onclick=()=>requestLeaveChat();
  document.addEventListener("click",e=>{if(chatMenu && !chatMenu.contains(e.target) && e.target!==$("endChat"))chatMenu.classList.remove("open")});
}
const CHAT_WALLPAPERS=[
  {id:"sunset",name:"Sunset Bloom",className:"wp-sunset"},
  {id:"candy",name:"Candy Shapes",className:"wp-candy"},
  {id:"ocean",name:"Ocean Waves",className:"wp-ocean"},
  {id:"garden",name:"Botanical Garden",className:"wp-garden"},
  {id:"confetti",name:"Color Confetti",className:"wp-confetti"},
  {id:"paper",name:"Pastel Paper",className:"wp-paper"}
];
let pendingChatWallpaperId=null;
let pendingChatWallpaperOriginal=null;
function applyChatWallpaper(id, wallpaperId){
  const box=$("chatStage")?.querySelector(".chatbox"); if(!box)return;
  box.classList.remove(...CHAT_WALLPAPERS.map(w=>"wallpaper-"+w.id));
  const selected=wallpaperId||state.chatWallpapers?.[id]||"sunset";
  box.classList.add("wallpaper-"+selected);
}
function renderWallpaperOptions(id){
  const grid=$("wallpaperGrid"); if(!grid)return;
  const selected=pendingChatWallpaperId||state.chatWallpapers?.[id]||"sunset";
  grid.innerHTML=CHAT_WALLPAPERS.map(w=>`<button type="button" class="wallpaper-option ${selected===w.id?"selected":""}" data-wallpaper="${w.id}"><span class="wallpaper-preview ${w.className}"></span><b>${w.name}</b>${selected===w.id?'<span class="wallpaper-check">✓</span>':''}</button>`).join("");
  qsa("[data-wallpaper]").forEach(b=>b.onclick=()=>{
    pendingChatWallpaperId=b.dataset.wallpaper;
    renderWallpaperOptions(id);
    applyChatWallpaper(id,pendingChatWallpaperId);
  });
}
function openWallpaperPicker(id){
  pendingChatWallpaperOriginal=state.chatWallpapers?.[id]||"sunset";
  pendingChatWallpaperId=pendingChatWallpaperOriginal;
  renderWallpaperOptions(id);
  openModal("chatWallpaperModal");
}
function closeWallpaperPicker(id,saveChoice=false){
  if(saveChoice){
    const chosen=pendingChatWallpaperId||pendingChatWallpaperOriginal||"sunset";
    state.chatWallpapers[id]=chosen;
    save();
    applyChatWallpaper(id,chosen);
    toast("Wallpaper applied ✓");
  }else{
    const original=pendingChatWallpaperOriginal||state.chatWallpapers?.[id]||"sunset";
    applyChatWallpaper(id,original);
  }
  pendingChatWallpaperId=null;
  pendingChatWallpaperOriginal=null;
  closeModal("chatWallpaperModal");
}

function showChatReaction(emoji){
  const layer=$("chatReaction"),target=$("chatReactionEmoji");
  if(!layer||!target)return;
  target.textContent=emoji;
  layer.classList.remove("show");
  void layer.offsetWidth;
  layer.classList.add("show");
  clearTimeout(window.__a2lChatReactionTimer);
  window.__a2lChatReactionTimer=setTimeout(()=>layer.classList.remove("show"),900);
}
function renderMessages(id){
 const arr=state.chats[id]?.messages||[];
 const statusIcon=m=>m.mine?(m.status==='read'?'✓✓':m.status==='delivered'?'✓✓':'✓'):'';
 const statusLabel=m=>m.mine&&m.status==='read'?' Read':m.mine&&m.status==='delivered'?' Delivered':' Sent';
 const time=m=>m.at?new Date(m.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
 $("messages").innerHTML=arr.length?arr.map(m=>`<div class="bubble-row ${m.mine?'outgoing':'incoming'}"><div class="bubble ${m.mine?'mine':'theirs'}"><div class="bubble-text">${safeText(m.text)}</div><div class="bubble-meta">${time(m)}${m.mine?` <span class="ticks ${m.status||'sent'}" title="${statusLabel(m).trim()}">${statusIcon(m)}</span>`:''}</div></div></div>`).join(''):`<button type="button" class="chat-say-hello" data-say-hello="${id}">Say hello to ${escapeHTML(friends.find(f=>f.id===id)?.name||"your friend")} 👋</button>`;
 const box=$("messages");if(box)box.scrollTop=box.scrollHeight;
}
function sendMessage(id){
 const input=$("messageInput"),text=input.value.trim();if(!text)return;
 const c=state.chats[id];
 if(!chatAccess(c).allowed){showPremiumGate();return;}
 const hasPhone=phone10.test(text);
 phone10.lastIndex=0;
 const hasAbuse=banned.some(r=>r.test(text));
 const warning=$("chatWarning");
 if(hasPhone||hasAbuse){
   if(warning){
     if(hasPhone&&hasAbuse) warning.textContent="⚠️ Warning: Phone numbers and abusive language are not allowed in chat.";
     else if(hasPhone) warning.textContent="⚠️ Warning: Phone numbers are not allowed in chat.";
     else warning.textContent="⚠️ Warning: Abusive language is not allowed in chat.";
     warning.classList.add("show");
   }
   toast(hasPhone?"Warning: Phone numbers are not allowed.":"Warning: Abusive language is not allowed.");
   input.focus({preventScroll:true});
   return;
 }
 c.messages=c.messages||[];
 const msg={text,mine:true,at:Date.now(),status:'sent'};
 c.messages.push(msg);
 save();
 renderMessages(id);
 const targetA2L=(friends.find(f=>Number(f.id)===Number(id))?.a2lId)||String(id);
 window.a2lRealtime?.send({type:'chat-message',to:targetA2L,text,tempId:msg.at});
 window.a2lBackend?.sendMessage(targetA2L,text).then(serverMsg=>{
   msg.serverId=serverMsg.id;
   msg.status='delivered';
   save();
   renderMessages(id);
 }).catch(e=>console.warn('message persistence:',e.message));
 input.value="";
 if(warning){warning.textContent="";warning.classList.remove("show");}
 renderMessages(id);
 setTimeout(()=>{if(!state.chats[id]||!state.chats[id].messages.includes(msg))return;if(msg.status==='sent')msg.status='delivered';save();renderMessages(id);},450);
 setTimeout(()=>{if(!state.chats[id]||!state.chats[id].messages.includes(msg))return;msg.status='read';save();renderMessages(id);},1200);
}
