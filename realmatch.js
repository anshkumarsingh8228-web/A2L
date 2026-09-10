/* A2L live matching, P2P media, reactions, friend requests and live chat. */
(function(){
  'use strict';
  let ws=null, stream=null, pc=null, peerId=null, peerName='A2L user', mode='video', initiator=false, iceQueue=[];
  let muted=false, cameraOn=true, facing='user', liveFriendId=null, remoteVideoTrack=null, remoteAudio=null, connectionTimer=null, disconnectTimer=null, callSource='random', awaitingAccept=false, acceptPending=false, autoFind=true, finding=false;
  const EMOJIS=['❤️','😂','😮','👍','👏','🔥','🎉','😍'];
  let reactionTimer=null, lastReactionAt=0, reactionBusy=false;
  const externalMessageListeners=new Set();
  const $=id=>document.getElementById(id);
  const text=(id,t)=>{const x=$(id);if(x)x.textContent=t};
  const wsUrl=()=> (location.protocol==='https:'?'wss://':'ws://')+location.host;
  const sessionId=window.a2lIdentity?.getSessionId?.()||('a2l_session_'+Date.now().toString(36));
  function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m));}
  function connect(){
    if(ws&&[0,1].includes(ws.readyState))return;
    ws=new WebSocket(wsUrl());
    ws.onopen=()=>send({type:'register',sessionId,name:state.profile.displayName||'A2L user',profile:{a2lId:state.profile.a2lId,name:state.profile.displayName||'A2L user',avatar:state.profile.avatar,ageGroup:state.profile.ageGroup,languages:state.profile.languages,interests:state.profile.interests,bio:state.profile.bio}});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m);externalMessageListeners.forEach(fn=>{try{fn(m)}catch(_){}})};
    ws.onclose=()=>{if(ws)ws=null};
  }
  function friendIdFor(sid){let h=0;for(let i=0;i<sid.length;i++)h=((h<<5)-h+sid.charCodeAt(i))|0;return -Math.max(1000,Math.abs(h));}
  function ensureLiveFriend(id,name,profile){
    const fid=friendIdFor(id);liveFriendId=fid;
    let f=friends.find(x=>Number(x.id)===fid);
    if(!f){
      f={id:fid,userId:id,name:name||profile?.name||'A2L user',a2lId:profile?.a2lId||id,avatar:profile?.avatar||'🙂',ageGroup:profile?.ageGroup||'16-17',languages:profile?.languages||['english'],online:true,interests:profile?.interests||[],bio:profile?.bio||'Live A2L connection'};
      friends.push(f);
    }else{f.name=name||profile?.name||f.name;f.userId=id;f.a2lId=profile?.a2lId||f.a2lId||id;f.avatar=profile?.avatar||f.avatar;f.ageGroup=profile?.ageGroup||f.ageGroup;f.languages=profile?.languages||f.languages;f.interests=profile?.interests||f.interests;f.bio=profile?.bio||f.bio;f.online=true;}
    state.chats[fid]=state.chats[fid]||{messages:[],source:'quick',ended:false,locked:false,startedAt:Date.now(),livePeerId:id};
    state.chats[fid].source='quick';state.chats[fid].ended=false;state.chats[fid].locked=false;state.chats[fid].livePeerId=id;save();
    return fid;
  }
  function showFinding(kind){
    finding=true;
    $('videoMatchArea').hidden=kind!=='video';$('voiceMatchArea').hidden=kind!=='voice';
    $('videoControls').hidden=true;$('voiceControls').hidden=true;
    $('findingScreen')?.toggleAttribute('hidden',false);
    $('remoteMatchVideo').hidden=true;$('remoteFallback').hidden=true;$('localMatchVideo').hidden=true;$('localFallback').hidden=true;
    text('matchSessionTitle',kind==='video'?'Video Match':'Voice Match');text('matchSessionStatus','Finding…');
    text('findingTitle','Finding someone to connect with…');text('findingStatus','Looking for a live user');
    $('matchSessionModal')?.classList.remove('is-connected');
    $('matchSessionModal')?.classList.add('show');$('matchSessionModal')?.setAttribute('aria-hidden','false');
  }
  function show(kind){
    finding=false;
    $('videoMatchArea').hidden=kind!=='video';$('voiceMatchArea').hidden=kind!=='voice';
    $('videoControls').hidden=kind!=='video';$('voiceControls').hidden=kind!=='voice';
    $('findingScreen')?.toggleAttribute('hidden',true);
    $('remoteMatchVideo').hidden=true;$('remoteFallback').hidden=false;$('localMatchVideo').hidden=kind!=='video';$('localFallback').hidden=true;
    text('matchSessionTitle',kind==='video'?'Video Match':'Voice Match');text('matchSessionStatus',callSource==='friend-call'&&initiator?'Calling…':'Connecting…');
    clearTimeout(connectionTimer);connectionTimer=setTimeout(()=>{if(pc?.connectionState!=='connected'){leaveAndFind('Connection timed out');}},30000);
    text('remoteVideoLabel',peerName);text('remoteMatchName',peerName);text('voiceRemoteName',peerName);text('localVideoLabel','You');
    const liveFriend=friends.find(f=>f.a2lId===peerId||f.name===peerName);
    text('remoteMatchAvatar',liveFriend?.avatar||'🙂'); text('voiceRemoteAvatar',liveFriend?.avatar||'🙂');
    text('localMatchAvatar',state.profile.avatar||'🙂'); text('voiceLocalAvatar',state.profile.avatar||'🙂');
    $('matchNext')?.toggleAttribute('hidden',true); $('voiceNext')?.toggleAttribute('hidden',true);
    $('matchSessionModal')?.classList.remove('is-connected');
    $('matchSessionModal')?.classList.add('show');$('matchSessionModal')?.setAttribute('aria-hidden','false');
    closeLiveChat();
    $('matchReactionLayer')?.setAttribute('aria-hidden','true');$('matchEmojiPicker')?.remove();
  }
  async function getMedia(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera and microphone access is not available in this browser.');
    return navigator.mediaDevices.getUserMedia(mode==='video'?{audio:true,video:{facingMode:facing,width:{ideal:1280},height:{ideal:720}}}:{audio:true,video:false});
  }
  function setupPeer(){
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',to:peerId,candidate:e.candidate});};
    pc.ontrack=e=>{
      if(e.track.kind==='video'){
        remoteVideoTrack=e.track;
        const v=$('remoteMatchVideo');
        if(v){v.srcObject=e.streams[0];v.hidden=false;$('remoteFallback').hidden=true;}
        e.track.onmute=()=>{if($('remoteMatchVideo'))$('remoteMatchVideo').hidden=true;if($('remoteFallback'))$('remoteFallback').hidden=false;text('remoteMatchMeta','Camera off · call continues');};
        e.track.onunmute=()=>{if($('remoteMatchVideo'))$('remoteMatchVideo').hidden=false;if($('remoteFallback'))$('remoteFallback').hidden=true;text('remoteMatchMeta','Live video');};
      }else if(e.track.kind==='audio'){
        if(!remoteAudio){remoteAudio=document.createElement('audio');remoteAudio.autoplay=true;remoteAudio.playsInline=true;remoteAudio.setAttribute('aria-hidden','true');document.body.appendChild(remoteAudio);}
        remoteAudio.srcObject=e.streams[0];
        remoteAudio.play().catch(()=>{});
      }
    };
    pc.onconnectionstatechange=()=>{
      const s=pc?.connectionState;
      if(s==='connected'){clearTimeout(connectionTimer);clearTimeout(disconnectTimer);text('matchSessionStatus','Connected · LIVE');$('matchSessionModal')?.classList.add('is-connected');if(callSource==='random'){$('matchNext')?.toggleAttribute('hidden',false);$('voiceNext')?.toggleAttribute('hidden',false)}send({type:'match-state',to:peerId,busy:true});}
      if(s==='disconnected'){text('matchSessionStatus','Reconnecting…');clearTimeout(disconnectTimer);disconnectTimer=setTimeout(()=>{if(pc?.connectionState==='disconnected')leaveAndFind('Connection lost');},5000);}
      if(s==='failed'){text('matchSessionStatus','Connection failed · retrying…');try{pc.restartIce();}catch(_){}clearTimeout(disconnectTimer);disconnectTimer=setTimeout(()=>{if(pc?.connectionState==='failed')leaveAndFind('Connection failed');},5000);}
      if(s==='closed')text('matchSessionStatus','Connection ended');
    };
    pc.oniceconnectionstatechange=()=>{if(pc?.iceConnectionState==='failed')text('matchSessionStatus','Network connection failed');};
  }
  async function flush(){for(const c of iceQueue.splice(0)){try{await pc.addIceCandidate(c)}catch(_){}}}
  async function start(kind,id,name,makeOffer,profile,source){
    mode=kind||'video';peerId=id;peerName=name||profile?.name||'A2L user';initiator=!!makeOffer;cameraOn=mode==='video';callSource=source||callSource||'random';awaitingAccept=callSource==='friend-call'&&initiator;ensureLiveFriend(id,peerName,profile);show(mode);
    send({type:'match-state',to:peerId,busy:true});
    try{
      stream=await getMedia();
      if(mode==='video'){$('localMatchVideo').srcObject=stream;$('localMatchVideo').hidden=false;$('localFallback').hidden=true;text('localMatchMeta','You · Camera on');$('matchCamera')?.classList.remove('off');}
      else text('voiceLocalMeta','You · Mic on');
      setupPeer();
      if(initiator&&(!awaitingAccept||acceptPending)){acceptPending=false;const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:'offer',to:peerId,sdp:offer,kind:mode,source:callSource});}
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
  function showReaction(emoji,remote=false){
    const layer=$('matchReactionLayer');if(!layer)return;
    layer.setAttribute('aria-hidden','false');
    const item=document.createElement('div');
    item.className='a2l-live-reaction '+(remote?'remote':'local');
    item.textContent=emoji;
    item.style.left=(12+Math.random()*76)+'%';
    item.style.setProperty('--reaction-drift',((Math.random()-.5)*70)+'px');
    item.style.setProperty('--reaction-scale',(0.85+Math.random()*.45).toFixed(2));
    layer.appendChild(item);
    while(layer.children.length>6)layer.firstElementChild.remove();
    item.addEventListener('animationend',()=>item.remove(),{once:true});
    clearTimeout(reactionTimer);
    reactionTimer=setTimeout(()=>{if(!layer.children.length)layer.setAttribute('aria-hidden','true')},1500);
  }
  function sendReaction(emoji){
    if(!peerId||!EMOJIS.includes(emoji)||reactionBusy)return;
    const now=Date.now();
    if(now-lastReactionAt<350)return;
    lastReactionAt=now;reactionBusy=true;
    send({type:'reaction',to:peerId,emoji,at:now});
    showReaction(emoji,false);
    setTimeout(()=>reactionBusy=false,180);
  }
  function toggleEmojiPicker(){
    let p=$('matchEmojiPicker');
    if(!p){
      p=document.createElement('div');p.id='matchEmojiPicker';p.className='a2l-reaction-picker';p.hidden=true;
      p.setAttribute('role','menu');p.setAttribute('aria-label','Choose a reaction');
      p.innerHTML=EMOJIS.map(e=>`<button type="button" role="menuitem" data-live-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('');
      $('matchSessionModal')?.appendChild(p);
      p.querySelectorAll('[data-live-emoji]').forEach(b=>b.addEventListener('click',()=>{sendReaction(b.dataset.liveEmoji);p.hidden=true;}));
    }
    p.hidden=!p.hidden;
    if(!p.hidden)p.querySelector('button')?.focus({preventScroll:true});
  }
  function requestFriend(){
    if(!peerId)return;send({type:'friend-request',to:peerId,request:{id:'live_'+Date.now()+'_'+Math.random().toString(36).slice(2),from:sessionId,fromName:state.profile.displayName,to:peerId,status:'pending',at:Date.now(),profile:{a2lId:state.profile.a2lId,name:state.profile.displayName,avatar:state.profile.avatar,ageGroup:state.profile.ageGroup,languages:state.profile.languages,interests:state.profile.interests,bio:state.profile.bio}}});toast('Friend request sent 🤝');
  }
  function incomingFriend(req){
    ensureLiveFriend(req.from,req.fromName,req.profile);state.connectionRequests=state.connectionRequests||{};state.connectionRequests[req.id]=req;save();window.__a2lLiveIncoming={...req,fid:liveFriendId};
    $('connectionRequestText').textContent=`${req.fromName||'A2L user'} wants to connect with you.`;openModal('connectionRequestModal');
  }
  function respondFriend(accepted){
    const req=window.__a2lLiveIncoming;if(!req)return;req.status=accepted?'accepted':'declined';send({type:'friend-response',to:req.from,requestId:req.id,accepted});
    if(accepted){const fid=ensureLiveFriend(req.from,req.fromName,req.profile);state.connections=state.connections||[];if(!state.connections.includes(fid))state.connections.push(fid);state.chats[fid].source='quick';state.chats[fid].locked=false;save();renderProfile?.();renderChats?.();toast('Friend request accepted 🤝');}
    else toast('Friend request declined');closeModal('connectionRequestModal');window.__a2lLiveIncoming=null;
  }
  function friendResponse(m){
    const req=Object.values(state.outgoingConnectionRequests||{}).find(r=>r.id===m.requestId);if(req){req.status=m.accepted?'accepted':'declined';save();}
    const fid=ensureLiveFriend(m.from,m.fromName||peerName);if(m.accepted){state.connections=state.connections||[];if(!state.connections.includes(fid))state.connections.push(fid);state.chats[fid].locked=false;save();toast('Friend request accepted 🤝');}else toast('Friend request declined');
  }
  async function handle(m){
    if(m.type==='registered'||m.type==='waiting') {if(m.type==='waiting'){showFinding(m.mode||mode);text('matchSessionStatus','Finding…');}return;}
    if(m.type==='call-invite'){
      if(peerId||pc){send({type:'call-busy',to:m.from});return;}
      const accepted=window.confirm(`${m.fromName||'A2L user'} is calling you for a ${m.kind==='video'?'video':'voice'} call.\n\nAccept?`);
      if(!accepted){send({type:'call-declined',to:m.from});return;}
      peerId=m.from;peerName=m.fromName||'A2L user';mode=m.kind||'video';callSource='friend-call';awaitingAccept=false;
      await start(mode,peerId,peerName,false,m.profile,'friend-call');
      send({type:'call-accept',to:peerId});
      return;
    }
    if(m.type==='call-accept'){
      if(peerId===m.from){awaitingAccept=false;acceptPending=true;text('matchSessionStatus','Accepted · connecting…');if(pc){acceptPending=false;const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:'offer',to:peerId,sdp:offer,kind:mode,source:'friend-call'});}}
      return;
    }
    if(m.type==='call-declined'){text('matchSessionStatus','Call declined');setTimeout(()=>end(false),500);return;}
    if(m.type==='call-busy'){text('matchSessionStatus','User is busy');setTimeout(()=>end(false),500);return;}
    if(m.type==='match-found'){peerId=m.peerId;peerName=m.peerName||m.peerProfile?.name||'A2L user';mode=m.mode||mode;initiator=!!m.initiator;if(mode==='text'){startTextMatch(peerId,peerName,m.peerProfile||null);return;}start(mode,peerId,peerName,initiator,m.peerProfile||null,'random');return;}
    if(m.type==='match-timeout'){showFinding(m.mode||mode);text('matchSessionStatus','Finding…');return;}
    if(m.type==='offer'){peerId=m.from;peerName=m.fromName||'A2L user';mode=m.kind||'video';if(!pc)await start(mode,peerId,peerName,false,m.peerProfile||null,m.source||'random');await pc.setRemoteDescription(m.sdp);await flush();const ans=await pc.createAnswer();await pc.setLocalDescription(ans);send({type:'answer',to:peerId,sdp:ans});return;}
    if(m.type==='answer'&&pc){await pc.setRemoteDescription(m.sdp);await flush();return;}
    if(m.type==='ice'){if(!pc){iceQueue.push(m.candidate);return}if(pc.remoteDescription)try{await pc.addIceCandidate(m.candidate)}catch(_){}else iceQueue.push(m.candidate);return;}
    if(m.type==='reaction'){if(EMOJIS.includes(m.emoji))showReaction(m.emoji,true);return;}
    if(m.type==='chat-message'){receiveChat(m.message||m);return;}
    if(m.type==='chat-delivered'){return;}
        // Friend requests/responses are handled by the Phase 7 social socket.
    if(m.type==='friend-request'||m.type==='friend-response')return;
    if(m.type==='peer-disconnected'){if(callSource==='random'&&autoFind){leaveAndFind('Finding another user…');}else{text('matchSessionStatus','Call ended');setTimeout(()=>end(false),300);}return;}
    if(m.type==='hangup'){if(callSource==='random'&&autoFind){leaveAndFind('Finding another user…');}else{text('matchSessionStatus','Call ended');setTimeout(()=>end(false),300);}}
  }
  function startTextMatch(id,name,profile){
    const fid=ensureLiveFriend(id,name,profile);
    state.chats[fid]=state.chats[fid]||{messages:[],source:'stranger',ended:false,locked:false,startedAt:Date.now(),livePeerId:id};
    state.chats[fid].source='stranger';state.chats[fid].ended=false;state.chats[fid].locked=false;state.chats[fid].livePeerId=id;save();
    send({type:'match-state',to:id,busy:true});
    peerId=id;peerName=name||'A2L user';callSource='random';
    $('matchSessionModal')?.classList.remove('show');$('matchSessionModal')?.setAttribute('aria-hidden','true');
    if(typeof go==='function')go('chat');
    if(typeof openChat==='function')openChat(fid);
    toast('You are connected 💬');
  }
  function startDirect(kind,id){
    const f=friends.find(x=>Number(x.id)===Number(id));
    const remoteId=f?.userId||f?.a2lId;
    if(!f||!f.isFriend){toast('You can only call accepted friends.');return;}
    if(!remoteId||!f.online){toast(f?.inCall?'This friend is currently in a call.':'This friend is offline.');return;}
    mode=kind||'video';peerId=remoteId;peerName=f.name||'A2L user';callSource='friend-call';awaitingAccept=true;
    connect();
    const invite=()=>send({type:'call-invite',to:peerId,kind:mode,source:'friend-call',profile:{a2lId:state.profile.a2lId,name:state.profile.displayName||'A2L user',avatar:state.profile.avatar,ageGroup:state.profile.ageGroup,languages:state.profile.languages,interests:state.profile.interests,bio:state.profile.bio}});
    if(ws?.readyState===1)invite();else ws?.addEventListener('open',invite,{once:true});
    start(mode,peerId,peerName,true,f,'friend-call');
  }
  function find(kind){autoFind=true;mode=kind||'video';connect();const run=()=>send({type:'find-match',mode,profile:{a2lId:state.profile.a2lId,name:state.profile.displayName||'A2L user',avatar:state.profile.avatar,ageGroup:state.profile.ageGroup,languages:state.profile.languages,interests:state.profile.interests,bio:state.profile.bio}});if(ws?.readyState===1)run();else ws?.addEventListener('open',run,{once:true});showFinding(mode);text('matchSessionStatus','Finding…');}
  function toggleMute(){if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);text('matchMute',muted?'🔇':'🎙️');text('voiceMute',muted?'🔇':'🎙️');text('localMatchMeta',muted?'You · Mic muted':'You · Camera on');text('voiceLocalMeta',muted?'You · Mic muted':'You · Mic on');}
  function toggleCamera(){
    if(mode!=='video'||!stream)return;
    cameraOn=!cameraOn;
    stream.getVideoTracks().forEach(t=>t.enabled=cameraOn);
    const v=$('localMatchVideo');
    if(v)v.hidden=!cameraOn;
    if($('localFallback'))$('localFallback').hidden=cameraOn;
    $('matchCamera')?.classList.toggle('off',!cameraOn);
    text('matchCamera',cameraOn?'📹':'🚫');
    text('localMatchMeta',cameraOn?'You · Camera on':'You · Camera off · Mic '+(muted?'muted':'on'));
  }
  async function switchCamera(){if(mode!=='video'||!stream)return;const current=stream.getVideoTracks()[0],next=facing==='user'?'environment':'user';try{const ns=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:next,width:{ideal:1280},height:{ideal:720}}});const nt=ns.getVideoTracks()[0],sender=pc?.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(nt);if(current){stream.removeTrack(current);current.stop()}stream.addTrack(nt);facing=next;$('localMatchVideo').srcObject=stream;toast(facing==='user'?'Front camera':'Back camera');}catch(_){toast('Could not switch camera on this device.');}}
  function nextMatch(){
    if(callSource!=='random')return;
    const nextMode=mode;
    end(true);
    autoFind=true;
    setTimeout(()=>find(nextMode),120);
  }
  function end(notify=true){
    autoFind=false;
    const oldPeer=peerId;
    if(notify&&oldPeer)send({type:'hangup',to:oldPeer});
    if(oldPeer)send({type:'match-state',to:oldPeer,busy:false});
    send({type:'cancel-match'});
    clearTimeout(connectionTimer);clearTimeout(disconnectTimer);
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
    if(remoteAudio){remoteAudio.srcObject=null;remoteAudio.remove();remoteAudio=null}
    if(pc){try{pc.close()}catch(_){}pc=null}
    peerId=null;peerName='A2L user';initiator=false;iceQueue=[];muted=false;cameraOn=true;facing='user';liveFriendId=null;remoteVideoTrack=null;callSource='random';awaitingAccept=false;acceptPending=false;
    finding=false;closeLiveChat();$('findingScreen')?.toggleAttribute('hidden',true);$('matchSessionModal')?.classList.remove('show');$('matchSessionModal')?.setAttribute('aria-hidden','true');
  }
  function leaveAndFind(status){
    if(!autoFind||callSource!=='random')return end(true);
    const nextMode=mode;
    end(true);
    autoFind=true;
    setTimeout(()=>{if(autoFind) {find(nextMode);text('matchSessionStatus',status||'Finding…');}},120);
  }
  function init(){
    connect();
    $('quickMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();find('video')},true);
    $('advancedMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openMatchModal()},true);
    $('matchStart')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const selected=$('[data-match-mode].selected')?.dataset.matchMode||'video';closeMatchModal();find(selected)},true);
    $('matchEnd')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);$('voiceEnd')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);$('matchBack')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();end(true)},true);
    $('matchMute')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleMute()},true);$('voiceMute')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleMute()},true);$('matchCamera')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleCamera()},true);
    $('matchSwitchCamera')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();switchCamera()},true);
    $('matchNext')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();nextMatch()},true);$('voiceNext')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();nextMatch()},true);
    $('matchEmoji')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleEmojiPicker()},true);$('voiceEmoji')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();toggleEmojiPicker()},true);
    $('matchAddFriend')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();requestFriend()},true);$('voiceAddFriend')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();requestFriend()},true);
    $('liveChatClose')?.addEventListener('click',closeLiveChat);$('liveChatSend')?.addEventListener('click',()=>{const i=$('liveChatInput');if(i?.value.trim()){const value=i.value.trim();const fid=liveFriendId;const c=state.chats[fid];c.messages.push({text:value,mine:true,at:Date.now(),status:'sent'});save();sendChat(value);i.value='';renderLiveChat();}});$('liveChatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('liveChatSend')?.click();}});
    // Make the existing connection modal genuinely live for requests received during a call.
    $('acceptConnection')?.addEventListener('click',e=>{if(window.__a2lLiveIncoming){e.preventDefault();e.stopImmediatePropagation();respondFriend(true)}},true);
    $('declineConnection')?.addEventListener('click',e=>{if(window.__a2lLiveIncoming){e.preventDefault();e.stopImmediatePropagation();respondFriend(false)}},true);
    window.a2lRealMatch={find,end,start,startDirect,nextMatch,sendChat,sendRaw:send,openLiveChat,onMessage(fn){if(typeof fn==='function')externalMessageListeners.add(fn);return()=>externalMessageListeners.delete(fn)},getPeerId:()=>peerId,getLiveFriendId:()=>liveFriendId};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
