/* Alone2Lone Hub, groups and rooms. */

function renderHub(kind="circle"){
  state.hubTab=kind;
  qsa(".hub-card").forEach(x=>x.classList.remove("active"));
  const map={circle:"hubCircle",reconnect:"hubReconnect",rooms:"hubRooms"};
  $(map[kind])?.classList.add("active");

  if(kind==="rooms"){
    $("hubContent").hidden=true;
    go("rooms");
    renderA2LRooms();
    return;
  }
  if(kind==="groups"){
    const box=$("hubContent");
    if(box){box.hidden=false;renderGroupDirectory(box);}
    return;
  }

  // Empty Friends/Reconnect state is a lightweight inline notice under A2L Rooms.
  $("hubContent").hidden=true;
  let notice=$("hubTransientNotice");
  if(!notice){
    notice=document.createElement("div"); notice.id="hubTransientNotice"; notice.className="hub-transient-notice";
    const grid=document.querySelector("#hub .hub-grid"); if(grid)grid.insertAdjacentElement("afterend",notice);
  }
  notice.textContent="No connections yet";
  notice.classList.add("show");
  clearTimeout(window.__hubNoticeTimer);
  window.__hubNoticeTimer=setTimeout(()=>notice.classList.remove("show"),3000);
}

function renderGroupDirectory(box){
  const rooms=Object.values(state.groupRooms||{}).filter(r=>r.members?.length);
  const cards=rooms.map(r=>`<div class="a2l-room"><span>👥</span><div class="grow"><b>${escapeHTML(r.name)}</b><div class="muted">${r.members.length}/6 members</div></div><button class="secondary" data-join-group="${r.id}">Join</button></div>`).join("");
  box.innerHTML=`<h3 style="margin-top:0">6-Person Groups 👥</h3><p class="muted">Up to 6 people. Group call, chat and multiplayer activities share one room.</p><button class="primary" id="createGroupBtn">＋ Create private group</button><div style="margin-top:12px" class="a2l-room-list">${rooms.length?cards:"<div class=\"a2l-empty\">No live groups yet. Create one and invite your circle.</div>"}</div>`;
  $("createGroupBtn").onclick=createGroup;qsa("[data-join-group]").forEach(b=>b.onclick=()=>joinGroup(b.dataset.joinGroup));
}
function createGroup(){const id="grp_"+Date.now();const room={id,name:"A2L Private Group",members:[{id:state.profile.a2lId,name:state.profile.displayName,avatar:state.profile.avatar}],mode:"video",messages:[],game:null,createdAt:Date.now()};state.groupRooms[id]=room;save();renderGroupRoom(id);go("grouproom");}
function joinGroup(id){const r=state.groupRooms[id];if(!r)return;if(!r.members.some(m=>m.id===state.profile.a2lId)){if(r.members.length>=6){toast("This group is full (6/6)");return}r.members.push({id:state.profile.a2lId,name:state.profile.displayName,avatar:state.profile.avatar});save();emitA2L("group-update",{roomId:id,room:r})}renderGroupRoom(id);go("grouproom")}
function renderGroupRoom(id){
  const r=state.groupRooms[id];if(!r)return;state.session={type:"group",roomId:id};save();
  const members=r.members.map(m=>`<div class="a2l-video-tile"><div><div class="avatar-big">${m.id===state.profile.a2lId && r.camera===false?"🙈":m.avatar}</div><b>${escapeHTML(m.name)}</b><div class="muted" style="color:#ddd">${m.id===state.profile.a2lId?(r.camera===false?"Camera off":"Camera on"):(r.mode==="text"?"Chat mode":"In group")}</div></div></div>`).join("");
  const messages=(r.messages||[]).map(m=>`<div class="a2l-request"><b>${escapeHTML(m.name)}</b><span class="grow">${safeText(m.text)}</span></div>`).join("")||'<div class="empty">Start the discussion.</div>';
  $("groupStage").innerHTML=`<div class="a2l-session"><div class="card"><div class="row between"><div><h2 style="margin:0">${escapeHTML(r.name)} 👥</h2><p class="muted">${r.members.length}/6 · Group room</p></div><span class="a2l-switch-pill">${r.mode==="video"?"📹 Video":r.mode==="voice"?"🎙️ Voice":"💬 Chat"} · LIVE</span></div><div class="a2l-session-top">${members}</div><div class="a2l-group-call-bar"><span>📞 Group call</span><span class="grow"></span><button class="secondary a2l-call-control ${r.mic===false?"off":"active"}" id="groupMic">🎙️ ${r.mic===false?"Mic off":"Mic on"}</button><button class="secondary a2l-call-control ${r.camera===false?"off":"active"}" id="groupCamera">📹 ${r.camera===false?"Camera off":"Camera on"}</button><button class="secondary a2l-call-control" id="groupSwitch">🔀 Switch</button></div></div><div class="card"><h3 style="margin-top:0">💬 Group Discussion</h3><div id="groupMessages" style="max-height:180px;overflow:auto">${messages}</div><div class="composer" style="margin-top:10px"><input id="groupInput" maxlength="300" placeholder="Message the group…"><button class="primary" id="groupSend">Send</button></div></div><div class="card"><div class="row between"><h3 style="margin:0">🎮 Group Activity</h3><span class="a2l-request-badge">6 MAX</span></div><div class="a2l-session-tools" style="margin-top:10px"><button class="secondary" id="groupInvite">➕ Invite connection</button><button class="secondary" id="groupGame">🎮 Start game</button><button class="secondary" id="groupChallenge">🎯 Challenge</button><button class="secondary" id="groupSurprise">🎲 Surprise</button><button class="danger" id="groupLeave">Leave group</button></div><div id="groupExtra">${r.game?`<div class="a2l-challenge"><b>🧠 Group game</b><br>${escapeHTML(r.game.question||"Everyone answer together.")}<div style="margin-top:8px"><input id="groupGameAnswer" maxlength="120" placeholder="Your answer…"><button class="secondary" id="groupGameAnswerBtn" style="margin-top:8px">Submit</button></div></div>`:""}</div></div></div>`;
  r.mic=r.mic!==false;r.camera=r.camera!==false;$("groupMic").onclick=()=>{r.mic=!r.mic;save();renderGroupRoom(id);emitA2L("group-update",{roomId:id,room:r})};$("groupCamera").onclick=()=>{r.camera=!r.camera;save();renderGroupRoom(id);emitA2L("group-update",{roomId:id,room:r})};$("groupSwitch").onclick=()=>{r.mode=r.mode==="video"?"voice":r.mode==="voice"?"text":"video";save();emitA2L("group-update",{roomId:id,room:r});renderGroupRoom(id)};
  $("groupInvite").onclick=()=>{const available=(state.connections||[]).map(cid=>friends.find(f=>f.id===cid)).filter(f=>f&&!r.members.some(m=>m.id===f.a2lId));if(r.members.length>=6){toast("Group is full (6/6)");return}if(!available.length){toast("Connect with someone first 🤝");return}const f=available[0];const req={id:"gr_"+Date.now()+"_"+Math.random().toString(36).slice(2),from:state.profile.a2lId,fromName:state.profile.displayName,to:f.a2lId,roomId:id,roomName:r.name,status:"pending",at:Date.now()};state.groupRequests[req.id]=req;save();emitA2L("group-invite",{to:f.a2lId,fromName:state.profile.displayName,roomId:id,roomName:r.name,request:req,room:r});toast(`Invite sent to ${f.name} 👥`)};
  $("groupSend").onclick=()=>{const input=$("groupInput"),text=input.value.trim();if(!text)return;const hasPhone=phone10.test(text);phone10.lastIndex=0;const hasAbuse=banned.some(x=>x.test(text));if(hasPhone||hasAbuse){toast("Phone numbers and abusive language are not allowed");return}r.messages.push({name:state.profile.displayName,text,at:Date.now()});r.messages=r.messages.slice(-40);save();emitA2L("group-update",{roomId:id,room:r});renderGroupRoom(id)};
  $("groupGame").onclick=()=>{r.game={type:"quiz",index:0,question:"What is one hobby you could teach someone?",answers:{}};save();emitA2L("group-update",{roomId:id,room:r});renderGroupRoom(id);};
  $("groupChallenge").onclick=()=>{$("groupExtra").innerHTML='<div class="a2l-challenge"><b>🎯 Group challenge</b><br>Everyone answer: What is one hobby you could teach someone?</div>'};
  if(r.game){$("groupGameAnswerBtn")?.addEventListener("click",()=>{const input=$("groupGameAnswer"),text=input.value.trim();if(!text)return;r.game.answers=r.game.answers||{};r.game.answers[state.profile.a2lId]=text;save();emitA2L("group-update",{roomId:id,room:r});renderGroupRoom(id);toast("Answer shared with the group 🧠")})}
  $("groupSurprise").onclick=()=>{$("groupExtra").innerHTML='<div class="a2l-challenge"><b>🎲 Surprise Us</b><br>Pick one: quiz, emoji challenge, or 60-second word game.</div>'};
  $("groupLeave").onclick=()=>{r.members=r.members.filter(m=>m.id!==state.profile.a2lId);state.session=null;save();emitA2L("group-update",{roomId:id,room:r});go("hub");renderHub("groups")};
}
function renderA2LRooms(){const box=$("roomsContent");if(!box)return;const rooms=[{id:"Gaming",icon:"🎮",title:"Gaming Room",desc:"Games + live discussion"},{id:"Music",icon:"🎵",title:"Music Room",desc:"Music talk + challenges"},{id:"Quiz",icon:"🧠",title:"Quiz Room",desc:"Fast questions with people"},{id:"Culture",icon:"🌍",title:"Culture Room",desc:"Culture exchange prompts"}];box.innerHTML=`<div class="room-directory-head"><div><span class="a2l-eyebrow">A2L COMMUNITY</span><h2>A2L Rooms 🏠</h2><p class="muted">Choose a room to preview, then join the live session.</p></div><span class="a2l-room-count">${rooms.length} rooms</span></div><div class="a2l-room-list">${rooms.map(r=>`<button class="a2l-room a2l-room-card" data-room="${r.id}" type="button"><span class="a2l-room-icon">${r.icon}</span><span class="grow"><b>${r.title}</b><small>${r.desc}</small></span><span class="a2l-room-arrow">›</span></button>`).join("")}</div>`;qsa("[data-room]").forEach(b=>b.onclick=()=>openRoomDetail(b.dataset.room));}
function openRoomDetail(name){const d={Gaming:{i:"🎮",t:"Gaming Room",d:"Play, talk and challenge people together."},Music:{i:"🎵",t:"Music Room",d:"Music talk and live challenges."},Quiz:{i:"🧠",t:"Quiz Room",d:"Fast questions and friendly brain games."},Culture:{i:"🌍",t:"Culture Room",d:"Culture exchange and everyday interests."}}[name];const box=$("roomDetailContent");if(!box)return;box.innerHTML=`<div class="room-detail-hero"><span class="a2l-room-big-icon">${d.i}</span><div><span class="a2l-eyebrow">A2L ROOM</span><h2>${d.t}</h2><p>${d.d}</p></div></div><div class="card"><div class="row between"><b>Live room</b><span class="a2l-live-pill">● LIVE</span></div><div class="a2l-member-row" style="margin-top:12px"><span class="a2l-member">You</span><span class="a2l-member">Guest 1</span><span class="a2l-member">Guest 2</span></div></div><div class="card"><p class="muted">Join to use room chat, mic/camera controls and the activity selector.</p><button class="primary" id="joinSelectedRoom">🚪 Join ${d.t}</button></div>`;$("joinSelectedRoom").onclick=()=>joinRoom(name);go("roomdetail");}
function joinRoom(name){
  const info={
    Gaming:{i:"🎮",p:"Pick a game or activity to start with everyone."},
    Music:{i:"🎵",p:"Share a favourite genre or discovery."},
    Quiz:{i:"🧠",p:"Start a quick question round."},
    Culture:{i:"🌍",p:"Ask an easy culture or everyday-life question."}
  }[name];
  const box=$("roomSessionContent");
  if(!info||!box)return;

  // Keep the existing room layout; only media state/controls are made reliable.
  state.roomSession={name,mic:true,camera:true,activity:null,messages:state.roomSession?.name===name?(state.roomSession.messages||[]):[]};
  save();
  box.innerHTML=`<div class="room-live-head"><div><span class="a2l-eyebrow">LIVE ROOM</span><h2>${info.i} ${name} Room</h2><p class="muted">Activity-first social room.</p></div><span class="a2l-live-pill">● LIVE</span></div>
  <div class="room-live-grid"><div class="a2l-room-self"><video id="roomLocalVideo" autoplay playsinline muted hidden></video><div class="avatar-big" id="roomLocalFallback">${state.profile.avatar||"💻"}</div><b>${escapeHTML(state.profile.displayName)}</b><span class="muted" id="roomMediaStatus">Mic on · Camera on</span></div><div class="a2l-room-members"><div class="row between"><b>Members</b><span class="muted">3 online</span></div><div class="a2l-member-row"><span class="a2l-member">Guest 1</span><span class="a2l-member">Guest 2</span></div></div></div>
  <div class="a2l-room-controls"><button class="a2l-room-control active" id="roomMic" type="button" aria-pressed="true">🎙️ <span>Mic</span></button><button class="a2l-room-control active" id="roomCamera" type="button" aria-pressed="true">📹 <span>Camera</span></button></div>
  <div class="card"><div class="row between"><div><h3 style="margin:0">Room Discussion</h3><span class="muted">${info.p}</span></div><span class="a2l-request-badge">LIVE</span></div><div id="roomMessages" class="room-messages"></div><div class="composer" style="margin-top:10px"><input id="roomInput" maxlength="300" placeholder="Message the room…" autocomplete="off"><button class="primary" id="roomSend" type="button">Send</button></div></div>
  <div class="card a2l-activity-card"><div class="row between"><div><h3 style="margin:0">Choose Activity</h3><span class="muted">Select first, then start it for the room.</span></div><span id="roomActivityState" class="a2l-switch-pill">No activity</span></div><div class="a2l-activity-grid"><button class="a2l-activity-choice" data-room-activity="quiz" type="button">🧠 Quick Quiz</button><button class="a2l-activity-choice" data-room-activity="ttt" type="button">❌⭕ Tic-Tac-Toe</button><button class="a2l-activity-choice" data-room-activity="emoji" type="button">😂 Emoji Challenge</button><button class="a2l-activity-choice" data-room-activity="prompt" type="button">💬 Icebreaker</button></div><button class="primary" id="roomStartActivity" disabled style="width:100%;margin-top:10px" type="button">▶ Start Activity</button><div id="roomExtra"></div></div>`;

  let media=null;
  const setRoomMediaUI=(key,on)=>{
    const btn=$(key==="mic"?"roomMic":"roomCamera");
    if(btn){
      btn.classList.toggle("active",on);
      btn.classList.toggle("off",!on);
      btn.setAttribute("aria-pressed",String(on));
      btn.innerHTML=key==="mic"?(on?"🎙️ <span>Mic</span>":"🔇 <span>Mic</span>"):(on?"📹 <span>Camera</span>":"🚫 <span>Camera</span>");
    }
    if($("roomMediaStatus"))$("roomMediaStatus").textContent=`Mic ${state.roomSession.mic?"on":"off"} · Camera ${state.roomSession.camera?"on":"off"}`;
  };
  const acquireTrack=async key=>{
    const kind=key==="camera"?"video":"audio";
    if(media){
      const existing=media.getTracks().find(t=>t.kind===kind && t.readyState!=="ended");
      if(existing){existing.enabled=true;return existing;}
    }
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("media_unavailable");
    const fresh=await navigator.mediaDevices.getUserMedia({video:key==="camera",audio:key==="mic"});
    if(!media)media=new MediaStream();
    const track=fresh.getTracks().find(t=>t.kind===kind);
    fresh.getTracks().filter(t=>t!==track).forEach(t=>t.stop());
    if(track)media.addTrack(track);
    return track;
  };
  const toggle=async key=>{
    const next=!state.roomSession[key];
    if(!next){
      state.roomSession[key]=false;
      const kind=key==="camera"?"video":"audio";
      // Disable, don't stop: the same MediaStreamTrack can be enabled again repeatedly.
      media?.getTracks().filter(t=>t.kind===kind).forEach(t=>t.enabled=false);
      save();
      setRoomMediaUI(key,false);
      if(key==="camera"){
        $("roomLocalVideo")?.setAttribute("hidden","");
        if($("roomLocalFallback"))$("roomLocalFallback").hidden=false;
      }
      return;
    }
    try{
      const track=await acquireTrack(key);
      if(!track)throw new Error("track_unavailable");
      track.enabled=true;
      state.roomSession[key]=true;
      save();
      setRoomMediaUI(key,true);
      if(key==="camera"){
        const video=$("roomLocalVideo"),fallback=$("roomLocalFallback");
        if(video){video.srcObject=media;video.hidden=false;video.play?.().catch(()=>{});}
        if(fallback)fallback.hidden=true;
      }
    }catch(e){
      state.roomSession[key]=false;
      save();
      setRoomMediaUI(key,false);
      toast((key==="camera"?"Camera":"Microphone")+" permission was not granted.");
    }
  };
  $("roomMic").onclick=()=>toggle("mic");
  $("roomCamera").onclick=()=>toggle("camera");
  setRoomMediaUI("mic",state.roomSession.mic);
  setRoomMediaUI("camera",state.roomSession.camera);

  let selected=null;
  qsa("[data-room-activity]").forEach(b=>b.onclick=()=>{
    selected=b.dataset.roomActivity;
    qsa("[data-room-activity]").forEach(x=>x.classList.toggle("selected",x===b));
    const stateBadge=$("roomActivityState");
    if(stateBadge)stateBadge.textContent=b.textContent.trim();
    const start=$("roomStartActivity");if(start)start.disabled=false;
  });
  $("roomStartActivity").onclick=()=>{
    if(!selected)return;
    $("roomExtra").innerHTML=`<div class="a2l-challenge"><b>▶ ${$("roomActivityState").textContent} started</b><br>Everyone in the room can join this activity.</div>`;
  };
  const sendRoom=()=>{
    const i=$("roomInput"),t=i?.value.trim();if(!t)return;
    const hasPhone=phone10.test(t);phone10.lastIndex=0;
    const hasAbuse=banned.some(x=>x.test(t));
    if(hasPhone||hasAbuse){toast("Phone numbers and abusive language are not allowed");return;}
    state.roomSession.messages=state.roomSession.messages||[];
    state.roomSession.messages.push({name:state.profile.displayName,text:t,at:Date.now()});
    state.roomSession.messages=state.roomSession.messages.slice(-40);
    save();
    const messages=$("roomMessages");
    if(messages)messages.innerHTML=state.roomSession.messages.map(m=>`<div class="a2l-request"><b>${escapeHTML(m.name)}</b><span class="grow">${safeText(m.text)}</span></div>`).join("");
    i.value="";
  };
  const roomSendBtn=$("roomSend"),roomInput=$("roomInput");
  roomSendBtn.addEventListener("pointerdown",e=>e.preventDefault());
  roomSendBtn.onclick=()=>{sendRoom();requestAnimationFrame(()=>roomInput?.focus({preventScroll:true}));};
  roomInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendRoom();requestAnimationFrame(()=>roomInput?.focus({preventScroll:true}));}});
  go("roomsession");
}

function showIncomingGroupInvite(req){window.__incomingGroupId=req.id;const ok=confirm(`${req.fromName} invited you to join ${req.roomName}. Join now?`);if(ok){const r=state.groupRooms[req.roomId];if(r)joinGroup(req.roomId);req.status="accepted";save();emitA2L("group-response",{to:req.from,requestId:req.id,accepted:true})}else{req.status="declined";save();emitA2L("group-response",{to:req.from,requestId:req.id,accepted:false})}}

