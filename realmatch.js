/* A2L live matching, P2P media, reactions, friend requests and live chat. */
(function(){
  'use strict';
  let ws=null, stream=null, pc=null, peerId=null, peerName='A2L user', mode='video', initiator=false, iceQueue=[];
  let muted=false, facing='user', liveFriendId=null;
  const EMOJIS=['❤️','😂','😮','👍','👏','🔥','🎉','😍'];
  const $=id=>document.getElementById(id);
  const text=(id,t)=>{const x=$(id);if(x)x.textContent=t};
  const wsUrl=()=> (location.protocol==='https:'?'wss://':'ws://')+location.host;
  const sessionId=(()=>{try{const k='a2l_device_session_id';let id=sessionStorage.getItem(k);if(!id){id=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));sessionStorage.setItem(k,id)}return id}catch(_){return Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}})();
  function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m));}
  function connect(){
    if(ws&&[0,1].includes(ws.readyState))return;
    ws=new WebSocket(wsUrl());
    ws.onopen=()=>send({type:'register',sessionId,name:state.profile.displayName||'A2L user'});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
    ws.onclose=()=>{if(ws)ws=null};
  }
  function friendIdFor(sid){let h=0;for(let i=0;i<sid.length;i++)h=((h<<5)-h+sid.charCodeAt(i))|0;return -Math.max(1000,Math.abs(h));}
  function ensureLiveFriend(id,name){
    const fid=friendIdFor(id);liveFriendId=fid;
    let f=friends.find(x=>Number(x.id)===fid);
    if(!f){
      f={id:fid,name:name||'A2L user',a2lId:id,avatar:'🙂',ageGroup:'16-17',languages:['english'],online:true,interests:[],bio:'Live A2L connection'};
      friends.push(f);
    }else{f.name=name||f.name;f.a2lId=id;f.online=true;}
    state.chats[fid]=state.chats[fid]||{messages:[],source:'quick',ended:false,locked:false,startedAt:Date.now(),livePeerId:id};
    state.chats[fid].source='quick';state.chats[fid].ended=false;state.chats[fid].locked=false;state.chats[fid].livePeerId=id;save();
    return fid;
  }
  function show(kind){
    $('videoMatchArea').hidden=kind!=='video';$('voiceMatchArea').hidden=kind!=='voice';
    $('videoControls').hidden=kind!=='video';$('voiceControls').hidden=kind!=='voice';
    $('remoteMatchVideo').hidden=true;$('remoteFallback').hidden=false;$('localMatchVideo').hidden=kind!=='video';$('localFallback').hidden=true;
    text('matchSessionTitle',kind==='video'?'Video Match':'Voice Match');text('matchSessionStatus',initiator?'Finding a live user…':'Connecting…');
    text('remoteVideoLabel',peerName);text('remoteMatchName',peerName);text('voiceRemoteName',peerName);text('localVideoLabel','You');
    $('matchSessionModal')?.classList.add('show');$('matchSessionModal')?.setAttribute('aria-hidden','false');
    closeLiveChat();
  }
  async function getMedia(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera and microphone access is not available in this browser.');
    return navigator.mediaDevices.getUserMedia(mode==='video'?{audio:true,video:{facingMode:facing,width:{ideal:1280},height:{ideal:720}}}:{audio:true,video:false});
  }
  function setupPeer(){
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',to:peerId,candidate:e.candidate});};
    pc.ontrack=e=>{const v=$('remoteMatchVideo');if(v){v.srcObject=e.streams[0];v.hidden=mode!=='video';$('remoteFallback').hidden=mode==='video';}};
    pc.onconnectionstatechange=()=>{const s=pc?.connectionState;if(s==='connected')text('matchSessionStatus','Connected · LIVE');if(['failed','closed'].includes(s))text('matchSessionStatus','Connection ended');};
    pc.oniceconnectionstatechange=()=>{if(pc?.iceConnectionState==='failed')text('matchSessionStatus','Network connection failed');};
  }
  async function flush(){for(const c of iceQueue.splice(0)){try{await pc.addIceCandidate(c)}catch(_){}}}
  async function start(kind,id,name,makeOffer){
    mode=kind||'video';peerId=id;peerName=name||'A2L user';initiator=!!makeOffer;ensureLiveFriend(id,peerName);show(mode);
    try{
      stream=await getMedia();
      if(mode==='video'){$('localMatchVideo').srcObject=stream;$('localMatchVideo').hidden=false;text('localMatchMeta','You · Camera on');}
      else text('voiceLocalMeta','You · Mic on');
      setupPeer();
      if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:'offer',to:peerId,sdp:offer,kind:mode,source:'real-match'});}
    }catch(e){toast(e.message||'Camera/microphone permission is required.');end(false);}
  }
  function renderLiveChat(){
    const box=$('liveChatMessages');if(!box)return;const c=liveFriendId&&state.chats[liveFriendId];const arr=c?.messages||[];
    box.innerHTML=arr.map(m=>`<div class="live-chat-msg ${m.mine?'mine':''}"><span>${safeText(m.text)}</span></div>`).join('')||'<div class="live-chat-empty">Say hello 👋</div>';
    box.scrollTop=box.scrollHeight;
  }
  function openLiveChat(){const p=$('liveChatPanel');if(!p)return;p.hidden=false;renderLiveChat();setTimeout(()=>$('liveChatInput')?.focus({preventScroll:true}),50);}
  function closeLiveChat(){const p=$('liveChatPanel');if(p)p.hidden=true;}
  function sendChat(message){const value=String(message||'').trim();if(!value||!peerId)return;send({type:'chat-message',to:peerId,text:value,at:Date.now()});}
  function receiveChat(m){
    const fid=ensureLiveFriend(m.from,m.fromName);const c=state.chats[fid];c.messages=c.messages||[];c.messages.push({text:String(m.text||''),mine:false,at:m.at||Date.now(),status:'received'});save();
    if($('liveChatPanel')&&!$('liveChatPanel').hidden)renderLiveChat();
    if(typeof activeChatId!=='undefined'&&Number(activeChatId)===fid&&document.getElementById('messages'))renderMessages(fid);
    toast(`Message from ${m.fromName||'A2L user'} 💬`);
  }
  function showReaction(emoji){const layer=$('matchReactionLayer');if(!layer)return;layer.innerHTML=`<div class="a2l-live-reaction">${escapeHTML(emoji)}</div>`;layer.setAttribute('aria-hidden','false');setTimeout(()=>{layer.innerHTML='';layer.setAttribute('aria-hidden','true')},1300);}
  function toggleEmojiPicker(){
    let p=$('matchEmojiPicker');if(!p){p=document.createElement('div');p.id='matchEmojiPicker';p.className='a2l-reaction-picker';p.hidden=true;p.innerHTML=EMOJIS.map(e=>`<button type="button" data-live-emoji="${e}">${e}</button>`).join('');$('matchSessionModal')?.appendChild(p);p.querySelectorAll('[data-live-emoji]').forEach(b=>b.onclick=()=>{send({type:'reaction',to:peerId,emoji:b.dataset.liveEmoji});p.hidden=true;showReaction(b.dataset.liveEmoji)});}
    p.hidden=!p.hidden;
  }
  function requestFriend(){
    if(!peerId)return;send({type:'friend-request',to:peerId,request:{id:'live_'+Date.now()+'_'+Math.random().toString(36).slice(2),from:sessionId,fromName:state.profile.displayName,to:peerId,status:'pending',at:Date.now()}});toast('Friend request sent 🤝');
  }
  function incomingFriend(req){
    ensureLiveFriend(req.from,req.fromName);state.connectionRequests=state.connectionRequests||{};state.connectionRequests[req.id]=req;save();window.__a2lLiveIncoming={...req,fid:liveFriendId};
    $('connectionRequestText').textContent=`${req.fromName||'A2L user'} wants to connect with you.`;openModal('connectionRequestModal');
  }
  function respondFriend(accepted){
    const req=window.__a2lLiveIncoming;if(!req)return;req.status=accepted?'accepted':'declined';send({type:'friend-response',to:req.from,requestId:req.id,accepted});
    if(accepted){const fid=ensureLiveFriend(req.from,req.fromName);state.connections=state.connections||[];if(!state.connections.includes(fid))state.connections.push(fid);state.chats[fid].source='quick';state.chats[fid].locked=false;save();renderProfile?.();renderChats?.();toast('Friend request accepted 🤝');}
    else toast('Friend request declined');closeModal('connectionRequestModal');window.__a2lLiveIncoming=null;
  }
  function friendResponse(m){
    const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===m.requestId);if(req){req.status=m.accepted?'accepted':'declined';save();}
    const fid=ensureLiveFriend(m.from,m.fromName||peerName);if(m.accepted){state.connections=state.connections||[];if(!state.connections.includes(fid))state.connections.push(fid);state.chats[fid].locked=false;save();toast('Friend request accepted 🤝');}else toast('Friend request declined');
  }
  async function handle(m){
    if(m.type==='registered'||m.type==='waiting') {if(m.type==='waiting')text('matchSessionStatus','Waiting for another live user…');return;}
    if(m.type==='match-found'){peerId=m.peerId;peerName=m.peerName||'A2L user';mode=m.mode||mode;initiator=!!m.initiator;start(mode,peerId,peerName,initiator);return;}
    if(m.type==='offer'){peerId=m.from;peerName=m.fromName||'A2L user';mode=m.kind||'video';if(!pc)await start(mode,peerId,peerName,false);await pc.setRemoteDescription(m.sdp);await flush();const ans=await pc.createAnswer();await pc.setLocalDescription(ans);send({type:'answer',to:peerId,sdp:ans});return;}
    if(m.type==='answer'&&pc){await pc.setRemoteDescription(m.sdp);await flush();return;}
    if(m.type==='ice'){if(!pc){iceQueue.push(m.candidate);return}if(pc.remoteDescription)try{await pc.addIceCandidate(m.candidate)}catch(_){}else iceQueue.push(m.candidate);return;}
    if(m.type==='reaction'){showReaction(m.emoji||'✨');return;}
    if(m.type==='chat-message'){receiveChat(m);return;}
    if(m.type==='friend-request'){incomingFriend(m.request||{from:m.from,fromName:m.fromName,id:'live_'+Date.now()});return;}
    if(m.type==='friend-response'){friendResponse(m);return;}
    if(m.type==='hangup'){text('matchSessionStatus','Call ended');setTimeout(()=>end(false),300);}
  }
  function find(kind){mode=kind||'video';connect();const run=()=>send({type:'find-match',mode,profile:{name:state.profile.displayName||'A2L user'}});if(ws?.readyState===1)run();else ws?.addEventListener('open',run,{once:true});show(mode);text('matchSessionStatus','Finding a live user…');}
  function toggleMute(){if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);text('matchMute',muted?'🔇':'🎙️');text('voiceMute',muted?'🔇':'🎙️');text('localMatchMeta',muted?'You · Mic muted':'You · Camera on');text('voiceLocalMeta',muted?'You · Mic muted':'You · Mic on');}
  async function switchCamera(){if(mode!=='video'||!stream)return;const current=stream.getVideoTracks()[0],next=facing==='user'?'environment':'user';try{const ns=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:next,width:{ideal:1280},height:{ideal:720}}});const nt=ns.getVideoTracks()[0],sender=pc?.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(nt);if(current){stream.removeTrack(current);current.stop()}stream.addTrack(nt);facing=next;$('localMatchVideo').srcObject=stream;toast(facing==='user'?'Front camera':'Back camera');}catch(_){toast('Could not switch camera on this device.');}}
  function end(notify=true){if(notify&&peerId)send({type:'hangup',to:peerId});send({type:'cancel-match'});if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(pc){try{pc.close()}catch(_){}pc=null}peerId=null;peerName='A2L user';initiator=false;iceQueue=[];muted=false;facing='user';liveFriendId=null;closeLiveChat();$('matchSessionModal')?.classList.remove('show');$('matchSessionModal')?.setAttribute('aria-hidden','true');}
  function init(){
    connect();
    $('quickMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();find('video')},true);
    $('advancedMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openMatchModal()},true);
    $('matchStart')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const selected=$('[data-match-mode].selected')?.dataset.matchMode||'video';closeMatchModal();if(selected==='text'){toast('Live text matching is not enabled yet.');return}find(selected)},true);
    $('matchEnd')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);$('voiceEnd')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);$('matchBack')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);
    $('matchMute')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleMute()},true);$('voiceMute')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleMute()},true);$('matchCamera')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();switchCamera()},true);
    $('matchEmoji')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleEmojiPicker()},true);$('voiceEmoji')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleEmojiPicker()},true);
    $('matchChat')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openLiveChat()},true);$('voiceChat')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openLiveChat()},true);
    $('matchAddFriend')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();requestFriend()},true);$('voiceAddFriend')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();requestFriend()},true);
    $('liveChatClose')?.addEventListener('click',closeLiveChat);$('liveChatSend')?.addEventListener('click',()=>{const i=$('liveChatInput');if(i?.value.trim()){const value=i.value.trim();const fid=liveFriendId;const c=state.chats[fid];c.messages.push({text:value,mine:true,at:Date.now(),status:'sent'});save();sendChat(value);i.value='';renderLiveChat();}});$('liveChatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('liveChatSend')?.click();}});
    // Make the existing connection modal genuinely live for requests received during a call.
    $('acceptConnection')?.addEventListener('click',e=>{if(window.__a2lLiveIncoming){e.preventDefault();e.stopImmediatePropagation();respondFriend(true)}},true);
    $('declineConnection')?.addEventListener('click',e=>{if(window.__a2lLiveIncoming){e.preventDefault();e.stopImmediatePropagation();respondFriend(false)}},true);
    window.a2lRealMatch={find,end,sendChat,openLiveChat,getPeerId:()=>peerId,getLiveFriendId:()=>liveFriendId};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
