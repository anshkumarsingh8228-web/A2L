/* Alone2Lone app core + bootstrap. */


"use strict";

const $=id=>document.getElementById(id);
const qsa=sel=>Array.from(document.querySelectorAll(sel));
let friends=[];


const banned=[/\bf+u+c+k+\b/i,/\bf+[u*]+c+k+\b/i,/\bmotherf+u+c+k+\b/i,/\bmad(?:a|h)?r?c?h+o+d+\b/i,/\bbehen\s*chod\b/i,/\bch[o0]d+\b/i];
const phone10=/\b(?:\d[\s-]?){10}\b/g;

const STATE_VERSION=6;
let state={chats:{},blocked:[],likes:{},connections:[],connectionRequests:{},outgoingConnectionRequests:{},chatRequests:{},playRequests:{},groupRooms:{},groupRequests:{},memories:{},interactions:{},premium:false,theme:"light",incognito:false,privacy:{message:"everyone",call:"everyone",requests:true,search:true},matchPrefs:{mode:"any",language:"any",age:"same",interest:"any",online:true},chatWallpapers:{},logicVersion:STATE_VERSION};
let activeChatId=null;
let activeChatProfile=false;
try{state=Object.assign(state,JSON.parse(localStorage.getItem("aloneToLoneState")||"{}"))}catch(e){}
// Reset only stale premium/access state from older prototype versions. New activations persist normally.
if(state.logicVersion!==STATE_VERSION){state.premium=false;state.logicVersion=STATE_VERSION;}
delete state.savedPeople;
state.chats=state.chats||{};state.blocked=state.blocked||[];state.likes=state.likes||{};state.connections=state.connections||[];state.connectionRequests=state.connectionRequests||{};state.outgoingConnectionRequests=state.outgoingConnectionRequests||{};state.chatRequests=state.chatRequests||{};state.playRequests=state.playRequests||{};state.groupRooms=state.groupRooms||{};state.groupRequests=state.groupRequests||{};state.memories=state.memories||{};state.interactions=state.interactions||{};state.matchPrefs=Object.assign({mode:"any",language:"any",age:"same",interest:"any",online:true},state.matchPrefs||{});state.privacy=Object.assign({message:"everyone",call:"everyone",requests:true,search:true},state.privacy||{});state.chatWallpapers=state.chatWallpapers||{};
const avatarOptions=["💻","🙂","😎","🎧","🎮","📚","🐼","🐱","🎯"];
const profileInterestOptions=["Gaming","Music","Coding","Art","Movies","Reading","Sports","Travel","Photography","Memes"];
function makeA2LId(){
  let id="a2l_"+Math.floor(100000+Math.random()*900000);
  const taken=new Set(friends.map(f=>String(f.a2lId||"").toLowerCase()));
  while(taken.has(id.toLowerCase())) id="a2l_"+Math.floor(100000+Math.random()*900000);
  return id;
}
state.profile=Object.assign({displayName:"You",a2lId:makeA2LId(),avatar:"💻",ageGroup:"16-17",bio:"Friendship-first • Here to meet interesting people.",status:"Available to chat",visibility:"private",interests:["Gaming","Music","Coding"],lookingFor:["Friendship","Chatting"]},state.profile||{});
if(!state.profile.a2lId)state.profile.a2lId=makeA2LId();
if(typeof state.likes.__me!=="number")state.likes.__me=0;

Object.keys(state.chats).forEach(id=>{
  const c=state.chats[id];
  if(Array.isArray(c)) state.chats[id]={messages:c,source:"suggested",ended:false};
  else if(c && !Array.isArray(c.messages)) c.messages=[];
  if(c && !c.source) c.source="suggested";
  if(c && typeof c.ended!=="boolean") c.ended=false;
});
// Legacy safety: old Ishita chat must never remain an unlocked suggested chat for a free user.
if(state.chats[8] && !state.premium){state.chats[8].source="suggested";state.chats[8].ended=true;}
Object.keys(state.chats).forEach(id=>{
  const c=state.chats[id];
  if(c){
    if(!['quick','friend','stranger','request'].includes(c.source)) c.source='suggested';
    c.locked=(c.ended===true) || (c.source==='suggested' && !state.premium);
  }
});
save();


function save(){try{localStorage.setItem("aloneToLoneState",JSON.stringify(state))}catch(_){}}
window.save=save;
window.state=state;
window.friends=friends;
Object.defineProperty(window,'a2lActiveChatId',{configurable:true,get:()=>activeChatId});
function renderPrivacyControls(){
  const p=state.privacy||{};
  if($("privacyMessage"))$("privacyMessage").value=p.message||"everyone";
  if($("privacyCall"))$("privacyCall").value=p.call||"everyone";
  if($("privacyRequests"))$("privacyRequests").checked=p.requests!==false;
  if($("privacySearch"))$("privacySearch").checked=p.search!==false;
}
function bindPrivacyControls(){
  [$("privacyMessage"),$("privacyCall"),$("privacyRequests"),$("privacySearch")].filter(Boolean).forEach(el=>{
    el.addEventListener("change",()=>{
      state.privacy={
        message:$("privacyMessage")?.value||"everyone",
        call:$("privacyCall")?.value||"everyone",
        requests:$("privacyRequests")?.checked!==false,
        search:$("privacySearch")?.checked!==false
      };
      save(); syncPrivacyDropdowns(); toast("Privacy settings saved ✓");
    });
  });
  initPrivacyDropdown("privacyMessage");
  initPrivacyDropdown("privacyCall");
  syncPrivacyDropdowns();
  $("enableCallNotifications")?.addEventListener("click",async()=>{try{if(!("Notification" in window)){toast("Notifications are not supported here.");return;}const p=await Notification.requestPermission();$("notificationStatus").textContent=p==="granted"?" Enabled ✓":` ${p}`;toast(p==="granted"?"Call notifications enabled ✓":"Notification permission not granted") }catch(e){toast("Could not enable notifications")}});
}
function initPrivacyDropdown(selectId){
  const select=$(selectId); if(!select || select.dataset.customReady==="1")return;
  select.dataset.customReady="1";
  const wrap=document.createElement("div"); wrap.className="a2l-custom-select"; wrap.dataset.selectId=selectId;
  select.parentNode.insertBefore(wrap,select); wrap.appendChild(select); select.classList.add("a2l-native-hidden-select");
  const trigger=document.createElement("button"); trigger.type="button"; trigger.className="a2l-custom-select-trigger"; trigger.setAttribute("aria-haspopup","listbox"); trigger.setAttribute("aria-expanded","false");
  const label=document.createElement("span"); label.className="a2l-custom-select-label";
  const chevron=document.createElement("span"); chevron.className="a2l-custom-select-chevron"; chevron.textContent="⌄";
  trigger.append(label,chevron); wrap.appendChild(trigger);
  const menu=document.createElement("div"); menu.className="a2l-custom-select-menu"; menu.setAttribute("role","listbox"); menu.hidden=true; wrap.appendChild(menu);
  Array.from(select.options).forEach(opt=>{
    const item=document.createElement("button"); item.type="button"; item.className="a2l-custom-select-option"; item.dataset.value=opt.value; item.setAttribute("role","option"); item.textContent=opt.textContent;
    item.onclick=()=>{select.value=opt.value;select.dispatchEvent(new Event("change",{bubbles:true}));closePrivacyDropdown(wrap);};
    menu.appendChild(item);
  });
  trigger.onclick=e=>{e.stopPropagation(); const open=!menu.hidden; closeAllPrivacyDropdowns(); if(!open){menu.hidden=false;trigger.setAttribute("aria-expanded","true");wrap.classList.add("open"); syncOnePrivacyDropdown(selectId);}};
}
function syncOnePrivacyDropdown(selectId){
  const select=$(selectId),wrap=document.querySelector(`.a2l-custom-select[data-select-id="${selectId}"]`); if(!select||!wrap)return;
  const label=wrap.querySelector(".a2l-custom-select-label"); if(label)label.textContent=select.options[select.selectedIndex]?.textContent||"";
  wrap.querySelectorAll(".a2l-custom-select-option").forEach(b=>{const active=b.dataset.value===select.value;b.classList.toggle("selected",active);b.setAttribute("aria-selected",String(active));});
}
function syncPrivacyDropdowns(){syncOnePrivacyDropdown("privacyMessage");syncOnePrivacyDropdown("privacyCall");}
function closePrivacyDropdown(wrap){const menu=wrap?.querySelector(".a2l-custom-select-menu"),trigger=wrap?.querySelector(".a2l-custom-select-trigger");if(menu)menu.hidden=true;if(trigger)trigger.setAttribute("aria-expanded","false");wrap?.classList.remove("open");}
function closeAllPrivacyDropdowns(){document.querySelectorAll(".a2l-custom-select.open").forEach(closePrivacyDropdown);}
document.addEventListener("click",e=>{if(!e.target.closest(".a2l-custom-select"))closeAllPrivacyDropdowns();});

function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function safeText(s){return escapeHTML(s).replace(phone10,"••••••••••")}
function toast(msg){const t=$("toast");t.textContent=msg;t.style.display="block";clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display="none",1800)}

function normalizeChatEntitlements(){
  Object.values(state.chats||{}).forEach(c=>{
    if(!c)return;
    c.messages=Array.isArray(c.messages)?c.messages:[];
    c.source=['quick','friend','stranger','request'].includes(c.source)?c.source:'suggested';
    c.ended=!!c.ended;
    if(['quick','friend','stranger','request'].includes(c.source)) c.locked=!!c.ended;
    else c.locked=!state.premium || c.ended;
  });
}
function syncPremiumUI(){
  const active=!!state.premium;
  const upgrade=$("upgrade"), note=$("premiumNote");
  const premiumMenuLabel=$("premiumMenuLabel");
  if(premiumMenuLabel) premiumMenuLabel.textContent=active?"Premium Member":"Upgrade Premium";
  if(upgrade){
    upgrade.innerHTML=active?"✓ Premium Demo Active":"Activate Premium Demo <span class=\"metallic-star premium-button-star\" aria-hidden=\"true\">★</span>";
    upgrade.setAttribute("aria-pressed",String(active));
  }
  if(note) note.textContent=active?"Premium unlocked — chat with people from Suggested Chats & Search.":"Premium unlocks chats from Suggested Chats & Search.";
  qsa(".premiumAction").forEach(b=>{
    b.disabled=!active;
    b.title=active?"":"Activate Premium Demo first";
  });
  normalizeChatEntitlements();
  save();
  renderPeople();
  initChatSelectionControls();
  renderChats();
}

function go(page){
 if(activeChatId && !activeChatProfile && page!=="chat" && page!=="gameplay" && page!=="grouproom" && !pendingChatExit){
   requestLeaveChat();
   return;
 }
 document.body.classList.toggle("chat-mode",page==="chat");
 document.body.classList.toggle("room-session-mode",page==="roomsession");
 document.body.classList.toggle("group-room-mode",page==="grouproom");
 // Clear the temporary visualViewport sizing used by the chat keyboard fix.
 // Otherwise Android can leave the page body stuck at the keyboard height,
 // which creates the large white area seen below the content.
 if(page!=="chat"){
   document.body.style.height="";
   document.body.style.top="";
   document.body.style.bottom="";
   
 }
 qsa(".page").forEach(p=>p.classList.toggle("active",p.id===page));
 qsa(".navbtn").forEach(b=>b.classList.toggle("active",b.dataset.page===page || (page==="profileEditPage" && b.dataset.page==="profile")));
 window.scrollTo({top:0,behavior:"smooth"});
 if(page==="home")renderPeople();
 if(page==="chats")renderChats();
 if(page==="rooms"){renderA2LRooms();}
 if(page==="profile")renderProfile();
 if(page==="history")renderHistory();
 $("moreMenu").classList.remove("open");
}

// Keep fixed bottom navigation out of the way whenever an on-screen keyboard is active.
// Uses VisualViewport when available, with a small mobile focus fallback for embedded webviews.
(function setupKeyboardNavigation(){
  const isEditable=el=>!!el && !!el.matches?.('input,textarea,select,[contenteditable="true"]');
  const isMobile=()=>window.matchMedia?.('(max-width: 900px)').matches ?? (window.innerWidth<=900);
  let timer=0;
  let focusedEditable=false;

  const update=()=>{
    const active=document.activeElement;
    const vv=window.visualViewport;
    const viewportHeight=vv?.height||window.innerHeight;
    const windowHeight=window.innerHeight;
    const keyboardDelta=windowHeight-viewportHeight>100;
    const chatOpen=document.body.classList.contains('chat-mode');
    const roomTextInput=active?.id==="roomInput" || active?.id==="groupInput";
    const keyboardLikely=isEditable(active) && (keyboardDelta || (isMobile() && focusedEditable && (chatOpen || roomTextInput)));
    document.body.classList.toggle('keyboard-open',!!keyboardLikely);
  };

  const schedule=()=>{clearTimeout(timer);timer=setTimeout(update,60);};
  document.addEventListener('focusin',e=>{
    if(isEditable(e.target)){focusedEditable=true;}
    schedule();
  },{passive:true});
  document.addEventListener('focusout',e=>{
    if(isEditable(e.target)){
      focusedEditable=false;
    }
    schedule();
  },{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('orientationchange',schedule,{passive:true});
  update();
})();

function suggestedFriends(){
  const search=$("suggestedSearch").value.trim().toLowerCase().replace(/^@/,"");
  const unique=new Map();
  friends.forEach(f=>{
    const key=String(f.userId||f.a2lId||f.name||f.id).toLowerCase();
    if(!key||state.blocked.includes(f.id))return;
    if(search && !String(f.name||"").toLowerCase().includes(search) && !String(f.a2lId||"").toLowerCase().includes(search))return;
    const prev=unique.get(key);
    if(!prev || (f.online&&!prev.online)) unique.set(key,f);
  });
  return Array.from(unique.values());
}

function personHTML(f){
  const connected=(state.connections||[]).map(Number).includes(Number(f.id));
  const pending=state.outgoingConnectionRequests?.[f.userId||f.a2lId]?.status==="pending";
  const likes=Number(state.likes?.[f.id]||0).toLocaleString();
  const visibleInterests=(f.interests||[]).slice(0,3);
  const status=f.online?"Online":"Offline";
  const avatarHtml=String(f.avatar_url||f.avatar||"🙂").startsWith("http")?`<img src="${escapeHTML(f.avatar_url||f.avatar)}" alt="${escapeHTML(f.name)}">`:escapeHTML(f.avatar||"🙂");
  return `<div class="person" data-profile="${f.id}" role="button" tabindex="0">
    <div class="person-avatar-wrap"><div class="avatar person-avatar">${avatarHtml}</div><span class="person-online-dot ${f.online?"is-online":""}" aria-hidden="true"></span></div>
    <div class="personmain">
      <div class="person-title-row"><b>${escapeHTML(f.name)}</b></div>
      <div class="person-id-status"><span class="a2l-person-id">@${escapeHTML(f.a2lId||"a2l_user")}</span><span class="status ${f.online?"online":"offline"}">${status}</span></div>
      <div class="person-social-meta"><span>❤️ ${likes} likes</span>${visibleInterests.map(x=>`<span>${escapeHTML(x)}</span>`).join("")}</div>
    </div>
    <div class="person-actions"><button class="chat-unified" data-chat="${f.id}">${state.premium?"Chat":"🔒 Chat"}</button></div>
  </div>`;
}
function renderPeople(){
  const list=suggestedFriends();
  $("people").innerHTML=list.length?list.map(personHTML).join(""):`<div class="card empty">No people found. Try another name.</div>`;
  $("resultCount").textContent=list.length+" found";
  qsa("[data-chat]").forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const id=Number(b.dataset.chat);
    if(!state.premium){showPremiumGate();return;}
    state.chats[id]=state.chats[id]||{messages:[],source:"suggested",ended:false,locked:false,startedAt:Date.now()};
    state.chats[id].source="suggested";
    state.chats[id].ended=false;
    state.chats[id].locked=false;
    save();
    openChat(id);
  });
  qsa("[data-profile]").forEach(x=>{
    const open=()=>openProfile(Number(x.dataset.profile));
    x.onclick=()=>open();
    x.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("button")){e.preventDefault();open();}};
  });
}

function renderProfileFriends(){
  const ids=[...(state.connections||[])].map(Number).filter(id=>friends.some(f=>f.id===id));
  const list=$("profileFriendsList");
  if(list){
    list.innerHTML=ids.length?ids.map(id=>{
      const f=friends.find(x=>x.id===id);
      return `<button class="profile-friend-row" type="button" data-profile-friend="${id}">
        <span class="profile-friend-avatar">${String(f?.avatar_url||f?.avatar||"🙂").startsWith("http")?`<img src="${escapeHTML(f.avatar_url||f.avatar)}" alt="${escapeHTML(f.name||"Friend")}">`:escapeHTML(f?.avatar||"🙂")}</span>
        <span class="profile-friend-main"><b>${escapeHTML(f?.name||"Friend")}</b><small>${f?.online?"Online":"Offline"} · ${(f?.interests||[]).slice(0,2).map(escapeHTML).join(" · ")}</small></span>
        <span class="profile-friend-arrow">›</span>
      </button>`;
    }).join(""):'<div class="profile-friends-empty">No friends yet.</div>';
  }
  const reconnectIds=[...new Set([
    ...Object.keys(state.memories||{}).map(Number),
    ...Object.keys(state.chats||{}).map(Number).filter(id=>state.chats[id]?.ended===true)
  ])].filter(id=>friends.some(f=>f.id===id)&&!ids.includes(id)&&!(state.blocked||[]).includes(id));
  const reconnectList=$("profileReconnectList");
  if(reconnectList){
    reconnectList.innerHTML=reconnectIds.length?reconnectIds.slice(0,5).map(id=>{
      const f=friends.find(x=>x.id===id);
      return `<button class="profile-reconnect-row" type="button" data-reconnect-friend="${id}">
        <span>${String(f?.avatar_url||f?.avatar||"🙂").startsWith("http")?`<img src="${escapeHTML(f.avatar_url||f.avatar)}" alt="${escapeHTML(f.name||"Friend")}">`:escapeHTML(f?.avatar||"🙂")}</span><span class="grow"><b>${escapeHTML(f?.name||"Friend")}</b><small>Pick up where you left off</small></span><span>›</span>
      </button>`;
    }).join(""):'<div class="profile-reconnect-empty">No reconnects yet.</div>';
  }
  qsa("[data-profile-friend]").forEach(b=>b.onclick=()=>openChat(Number(b.dataset.profileFriend)));
  qsa("[data-reconnect-friend]").forEach(b=>b.onclick=()=>reconnectPerson(Number(b.dataset.reconnectFriend)));
  if($("profileFriendsOpen"))$("profileFriendsOpen").onclick=()=>{
    const list=$("profileFriendsList");
    if(list) list.scrollIntoView({behavior:"smooth",block:"center"});
  };
}
function reconnectPerson(id){
  const f=friends.find(x=>x.id===Number(id));
  if(!f)return;
  const c=state.chats[f.id]||{messages:[],source:"reconnect",ended:false,locked:false,startedAt:Date.now()};
  c.source="reconnect";c.ended=false;c.locked=false;state.chats[f.id]=c;
  state.memories=state.memories||{};delete state.memories[f.id];
  save();
  if(typeof renderChats==="function")renderChats();
  if(!state.premium){showPremiumGate();return;}
  openChat(f.id);
  toast(`Reconnected with ${f.name} 🔄`);
}
function renderProfile(){
  const p=state.profile;
  $("profileDisplayName").textContent=p.displayName;
  $("profileA2LId").textContent="@"+p.a2lId;
  $("profileBioPreview").textContent=p.bio;
  const myLikes=Number(state.likes.__me||0);
  if($("profileLikeCount"))$("profileLikeCount").textContent=`❤️ ${myLikes.toLocaleString()} likes`;
  if($("profileConnectionStatus"))$("profileConnectionStatus").textContent=(state.connections||[]).length?`${state.connections.length} people in your circle`:"Open to new connections";
  renderProfileFriends();
  $("profileVisibilityLabel").textContent=(p.visibility||"private")==="private"?"Private":"Public";
  const visibilityBtn=$("profileVisibilityToggle");
  if(visibilityBtn) visibilityBtn.textContent=(p.visibility||"private")==="private"?"Make public":"Make private";
  $("profileNameInput").value=p.displayName;
  $("profileIdInput").value=p.a2lId;
  $("profileBioInput").value=p.bio;
  const avatarEl=$("profileAvatarPreview");
  const avatarSource=p.photoData||p.avatar_url;
  if(avatarSource&&String(avatarSource).startsWith("http")){avatarEl.innerHTML=`<img class="profile-photo-img" src="${escapeHTML(avatarSource)}" alt="Profile photo">`;avatarEl.classList.add("has-photo");}
  else if(p.photoData){avatarEl.innerHTML=`<img class="profile-photo-img" src="${p.photoData}" alt="Profile photo">`;avatarEl.classList.add("has-photo");}
  else{avatarEl.textContent=p.avatar||"💻";avatarEl.classList.remove("has-photo");}
  const avatarWrap=avatarEl.closest(".a2l-avatar-edit-wrap");
  const previewWrap=$("profilePhotoPreviewWrap");
  if(previewWrap){
    const previewSource=p.photoData||p.avatar_url; previewWrap.innerHTML=previewSource&&String(previewSource).startsWith("http")?`<img src="${escapeHTML(previewSource)}" alt="Profile photo preview">`:p.photoData?`<img src="${p.photoData}" alt="Profile photo preview">`:`<span aria-hidden="true">${p.avatar||"💻"}</span>`;
  }
  $("avatarPicker").innerHTML=avatarOptions.map(a=>`<button class="avatar-option ${p.avatar===a?"selected":""}" data-avatar="${a}" aria-label="Use ${a}">${a}</button>`).join("");
  const interests=Array.isArray(p.interests)?p.interests:[];
  p.interests=interests;
  $("profileInterests").innerHTML=profileInterestOptions.map(x=>`<button class="profile-choice ${interests.includes(x)?"selected":""}" data-interest="${x}">${x}</button>`).join("");
  $("profileInterestsPreview").innerHTML=(p.interests||[]).length ? p.interests.map(x=>`<span class="profile-public-chip">${escapeHTML(x)}</span>`).join("") : '<span class="muted">No interests added yet.</span>';
  qsa("[data-avatar]").forEach(b=>b.onclick=()=>{
    p.avatar=b.dataset.avatar;
    // Selecting an avatar intentionally replaces the custom profile photo.
    delete p.photoData; delete p.avatar_url;
    save();
    window.a2lData?.saveProfile?.().then(r=>{if(r?.error)toast("Avatar updated locally; cloud sync failed");});
    renderProfile();
    toast("Avatar updated ✓");
  });
  qsa("[data-interest]").forEach(b=>b.onclick=()=>{p.interests=p.interests.includes(b.dataset.interest)?p.interests.filter(x=>x!==b.dataset.interest):[...p.interests,b.dataset.interest];renderProfile();});
}
// ---- Profile photo media (prototype/local browser) ----

/* Bootstrap / UI wiring */
document.addEventListener("click",e=>{if(!$("moreMenu").contains(e.target)&&e.target!==$("moreBtn"))$("moreMenu").classList.remove("open")});
qsa("[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page));
if(typeof initChatCategoryControls==="function")initChatCategoryControls();
if($("moreBtn")&&$("moreMenu")){$("moreBtn").onclick=e=>{e.preventDefault();e.stopPropagation();$("moreMenu").classList.toggle("open")};}
if($("suggestedSearch"))$("suggestedSearch").oninput=()=>{renderPeople();window.a2lSocial?.refreshDirectory?.($("suggestedSearch").value)};
$("quickMatch").onclick=(e)=>{e.preventDefault();startQuickMatchDirect();};
$("advancedMatch").onclick=(e)=>{e.preventDefault();openMatchModal();};
$("matchClose").onclick=closeMatchModal;$("matchCancel").onclick=closeMatchModal;$("matchStart").onclick=quickMatch;$("matchFiltersToggle")?.addEventListener("click",()=>{const d=$("matchFilterDrawer");if(!d)return;d.hidden=!d.hidden;$("matchFiltersToggle").setAttribute("aria-expanded",String(!d.hidden));if($("matchFilterChevron"))$("matchFilterChevron").textContent=d.hidden?"⌄":"⌃"});$("matchModal").addEventListener("click",e=>{if(e.target===$("matchModal"))closeMatchModal()});
qsa("[data-game]").forEach(b=>b.onclick=()=>{go("gameplay");renderGame(b.dataset.game)});
if($("roomsBack"))$("roomsBack").onclick=()=>{go("home")};
if($("roomDetailBack"))$("roomDetailBack").onclick=()=>{go("rooms");renderA2LRooms()};
if($("roomLeave"))$("roomLeave").onclick=()=>{go("rooms");renderA2LRooms()};
if($("groupBack"))$("groupBack").onclick=()=>{state.session=null;save();go("hub");renderHub("groups")};
$("hubPopupClose")?.addEventListener("click",()=>closeModal("hubPopupModal"));
$("hubPopupModal")?.addEventListener("click",e=>{if(e.target.id==="hubPopupModal")closeModal("hubPopupModal")});
$("chatCallClose")?.addEventListener("click",()=>closeModal("chatCallModal"));
$("hubRooms")?.addEventListener("click",()=>{go("rooms");renderA2LRooms()});
$("newFriendChatClose")?.addEventListener("click",()=>closeModal("newFriendChatModal"));
$("newFriendChatModal")?.addEventListener("click",e=>{if(e.target.id==="newFriendChatModal")closeModal("newFriendChatModal")});
$("activityClose")?.addEventListener("click",()=>closeModal("activityModal"));$("chatActionsClose")?.addEventListener("click",()=>closeModal("chatActionsModal"));$("connectionRequestClose")?.addEventListener("click",()=>closeModal("connectionRequestModal"));$("declineConnection")?.addEventListener("click",()=>respondConnection(false));$("acceptConnection")?.addEventListener("click",()=>respondConnection(true));
qsa("[data-play-game]").forEach(b=>b.addEventListener("click",()=>{playGame=b.dataset.playGame;qsa("[data-play-game]").forEach(x=>x.classList.toggle("selected",x===b))}));
$("playRequestClose")?.addEventListener("click",()=>closeModal("playRequestModal"));$("playRequestCancel")?.addEventListener("click",()=>closeModal("playRequestModal"));$("sendPlayRequest")?.addEventListener("click",createPlayRequest);$("incomingClose")?.addEventListener("click",()=>closeModal("incomingRequestModal"));$("declineIncoming")?.addEventListener("click",()=>respondPlayRequest(false));$("acceptIncoming")?.addEventListener("click",()=>respondPlayRequest(true));$("switchModeClose")?.addEventListener("click",()=>closeModal("switchModeModal"));qsa("[data-switch-mode]").forEach(b=>b.addEventListener("click",()=>switchMode(b.dataset.switchMode)));$("challengeClose")?.addEventListener("click",()=>closeModal("challengeModal"));
qsa("[data-challenge]").forEach(b=>b.addEventListener("click",()=>{const target=$("challengeModal").dataset.target;const labels={question:"Same-answer question: what is something you could talk about for hours?",emoji:"Emoji challenge: describe your day using three emojis.",word:"Word challenge: make a word from the letters A2L.",draw:"Draw challenge: both sketch the same simple object."};closeModal("challengeModal");if(state.session){$("sessionExtra").innerHTML=`<div class="a2l-challenge"><b>🎯 Challenge</b><br>${labels[b.dataset.challenge]}</div>`;rememberInteraction(state.session.partnerId,"Started a two-person challenge")}else if(target){state.chats[target]=state.chats[target]||{messages:[],source:"suggested",ended:false,locked:false};save();openChat(target);toast("Challenge ready 🎯")}}));

$("gameBack").onclick=()=>{if(state.session?.type==="play")state.session=null;activeChatId=null;activeChatProfile=false;save();go("games")};
let pendingChatExit=false;
function hideChatConfirm(){$("chatConfirm").classList.remove("show");pendingChatExit=false;}
function requestLeaveChat(){
 if(!activeChatId||activeChatProfile){activeChatId=null;activeChatProfile=false;go("chats");return;}
 const c=state.chats[activeChatId]; if(!c||c.ended){activeChatId=null;activeChatProfile=false;go("chats");return;}
 // Premium users leave directly; the confirmation popup is only for free users.
 if(state.premium){activeChatId=null;activeChatProfile=false;pendingChatExit=false;go("chats");return;}
 pendingChatExit=true;$("chatConfirmTitle").textContent="Leave this chat?";$("chatConfirmText").textContent="Going back will end and lock this chat. You can start a new chat later.";$("chatConfirmYes").textContent="Yes, go back";$("chatConfirmNo").textContent="No, stay";$("chatConfirm").classList.add("show");}
function requestEndChat(){
 if(!activeChatId)return;
 if(state.premium){finishChatExit();return;}
 pendingChatExit=true;$("chatConfirmTitle").textContent="End this chat?";$("chatConfirmText").textContent="Chat will be locked after ending. You can start a new chat later.";$("chatConfirmYes").textContent="Yes, end chat";$("chatConfirmNo").textContent="No, stay";$("chatConfirm").classList.add("show");}
function finishChatExit(){const id=activeChatId;if(id&&state.chats[id]){state.chats[id].ended=true;state.chats[id].locked=true;save();}activeChatId=null;activeChatProfile=false;hideChatConfirm();go("chats");}
$("chatConfirmNo").onclick=hideChatConfirm;$("chatConfirmYes").onclick=finishChatExit;$("chatConfirm").onclick=e=>{if(e.target===$("chatConfirm"))hideChatConfirm();};

$("chatBack").onclick=()=>requestLeaveChat();
$("clearHistory").onclick=()=>{if(confirm("Clear chat history?")){state.chats={};save();renderHistory();toast("History cleared 🧹")}};
$("clearData").onclick=()=>{if(confirm("Clear all local Alone2Lone demo data?")){localStorage.removeItem("aloneToLoneState");location.reload()}};
$("toggleTheme").onclick=()=>{
 state.theme=state.theme==="dark"?"light":"dark";document.body.classList.toggle("dark",state.theme==="dark");save();toast(state.theme==="dark"?"Dark mode enabled 🌙":"Light mode enabled ☀️");
};
$("toggleIncognito").onclick=()=>{
 state.incognito=!state.incognito;save();$("toggleIncognito").textContent=state.incognito?"Disable incognito":"Enable incognito";toast(state.incognito?"You are hidden from discovery 🕶️":"Discovery is visible again");
};
qsa(".premiumAction").forEach(b=>b.onclick=()=>{
 if(!state.premium){showPremiumGate();return;}
 const f=b.dataset.feature;
 if(f==="matching"){go("home");setTimeout(openMatchModal,50);}
 if(f==="incognito")$("toggleIncognito").click();
 if(f==="theme")$("toggleTheme").click();
 if(f==="cleanup")go("history");
 if(f==="reconnect"){go("profile");setTimeout(()=>document.getElementById("profileReconnectList")?.scrollIntoView({behavior:"smooth",block:"center"}),80)}
 if(f==="stats")toast("Game stats are local to this prototype 🎮");
});
$("profileSave").onclick=()=>{
  const name=$("profileNameInput").value.trim().replace(/\s+/g," ")||"You";
  let id=$("profileIdInput").value.trim().toLowerCase().replace(/^@/,"").replace(/[^a-z0-9_]/g,"").slice(0,20);
  const taken=new Set(friends.map(f=>String(f.a2lId||"").toLowerCase()));
  if(!id) id=makeA2LId();
  if(taken.has(id)) {toast("That A2L ID is already taken");return;}
  state.profile.displayName=name;
  state.profile.a2lId=id;
  state.profile.bio=$("profileBioInput").value.trim()||"Friendship-first • Here to meet interesting people.";
  state.profile.visibility=state.profile.visibility||"private";
  state.profile.interests=Array.isArray(state.profile.interests)?state.profile.interests:[];
  save();renderProfile();
  if(window.a2lData?.saveProfile) window.a2lData.saveProfile().then(r=>{if(r?.error)toast('Profile saved locally; cloud sync failed');else toast('Profile saved to A2L ✓')});
  go("profile");
  toast("Saving profile…");
};
$("profileEditMain").onclick=()=>{renderProfile();go("profileEditPage");};
$("profileEditBack").onclick=()=>go("profile");
$("profileEditTop").onclick=()=>{renderProfile();$("avatarModal").hidden=false;};
setupMediaFeatures();
$("avatarModalClose").onclick=()=>$("avatarModal").hidden=true;
$("avatarModalBackdrop").onclick=()=>$("avatarModal").hidden=true;
$("profileVisibilityToggle").onclick=()=>{state.profile.visibility=(state.profile.visibility||"private")==="public"?"private":"public";renderProfile();};
$("upgrade").onclick=()=>{
  state.premium=!state.premium;
  state.logicVersion=STATE_VERSION;
  save();
  syncPremiumUI();
  toast(state.premium?"Premium demo activated":"Premium demo deactivated");
};

// Browser back handling is intentionally disabled for local/content HTML files.
// Android's Downloads/content viewer owns the browser history, so manipulating
// history here can make the viewer immediately leave the HTML document.
// App navigation is handled internally by go(page) instead.

renderProfile();renderHistory();
if(state.theme==="dark")document.body.classList.add("dark");
if(state.incognito&&$("toggleIncognito"))$("toggleIncognito").textContent="Disable incognito";
normalizeChatEntitlements();
syncPremiumUI();
