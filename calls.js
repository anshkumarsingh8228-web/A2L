/* Alone2Lone production calls: standalone UI + real WebSocket/WebRTC logic. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let stream=null,pc=null,peer=null,mode='video',source='call',targetId=null;
  let muted=false,cameraOn=true,facing='user',speakerOn=true,pendingIce=[];
  let callHistoryId=null,remoteAudio=null;
  let RTC_CONFIG={
    iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun.cloudflare.com:3478'}
    ]
  };

  const send=m=>window.a2lRealtime?.send(m);
  const setText=(id,t)=>{const e=$(id);if(e)e.textContent=t;};
  const show=(id,on)=>{const e=$(id);if(e)e.hidden=!on;};
  const toastSafe=t=>{try{if(typeof toast==='function')toast(t);else console.info(t)}catch{}};

  function profile(){
    return (typeof state!=='undefined'&&state?.profile)||{};
  }

  function setStatus(t){
    setText('matchSessionStatus',t);
    setText('findingRemoteMeta',t);
    if(mode==='video')setText('remoteMatchMeta',t);
    else setText('voiceRemoteMeta',t);
  }

  function profileImage(url,avatar){
    const img=$('remoteMatchPhoto');
    if(!img)return;
    if(url&&url.length>10){
      img.src=url;
      img.style.display='block';
    }else{
      img.removeAttribute('src');
      img.style.display='none';
    }
  }

  async function loadRtcConfig(){
    try{
      const res=await fetch('/api/rtc-config',{cache:'no-store'});
      if(res.ok){
        const data=await res.json();
        if(data.iceServers?.length){
          RTC_CONFIG={iceServers:data.iceServers};
        }
      }
    }catch(e){
      // STUN fallback already in RTC_CONFIG
    }
  }

  async function connect(){
    try{
      await loadRtcConfig();
      return await window.a2lRealtime?.connect?.();
    }catch(e){
      setStatus(e.message||'Realtime connection failed.');
      throw e;
    }
  }

  let mediaPromise = null;
  async function getMedia(kind) {
    if (!mediaPromise) {
      mediaPromise = ensureMedia(kind).catch(e => { mediaPromise = null; throw e; });
    }
    return mediaPromise;
  }

  async function ensureMedia(kind='video'){
    if(stream&&stream.active){
      const hasAudio=stream.getAudioTracks().length>0;
      const videoTracks=stream.getVideoTracks();
      if(hasAudio && (kind==='video' ? videoTracks.length>0 : true)){
        if(kind==='voice' && videoTracks.length>0){
          videoTracks.forEach(t=>{t.stop(); stream.removeTrack(t);});
        }
        muted=!stream.getAudioTracks()[0]?.enabled;
        cameraOn=kind==='video';
        const lv=$('localMatchVideo');
        if(lv) lv.hidden=!cameraOn;
        show('localFallback',!cameraOn);
        setText('localMatchMeta',`Camera ${cameraOn?'on':'off'} · Mic ${muted?'off':'on'}`);
        setText('voiceLocalMeta',`Mic ${muted?'off':'on'} · listening`);
        setText('findingLocalMeta',`${cameraOn?'Camera on':'Camera off'} · Mic on`);
        return stream;
      }
    }

    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream=null;
    }

    if(!navigator.mediaDevices?.getUserMedia){
      throw new Error('Camera and microphone are not supported in this browser.');
    }

    const constraints={
      audio:true,
      video:kind==='video'?{facingMode,width:{ideal:1280},height:{ideal:720}}:false
    };

    stream=await navigator.mediaDevices.getUserMedia(constraints);
    muted=false;
    cameraOn=kind==='video';

    const lv=$('localMatchVideo');
    if(lv){
      lv.srcObject=stream;
      lv.hidden=!cameraOn;
      lv.muted=true;
      lv.play?.().catch(()=>{});
    }
    show('localFallback',!cameraOn);
    setText('localMatchMeta',`Camera ${cameraOn?'on':'off'} · Mic ${muted?'off':'on'}`);
    setText('voiceLocalMeta',`Mic ${muted?'off':'on'} · listening`);
    setText('findingLocalMeta',`${cameraOn?'Camera on':'Camera off'} · Mic on`);
    return stream;
  }

  function openModal(kind){
    mode=kind||'video';
    const m=$('matchSessionModal');
    m?.classList.add('show');
    m?.setAttribute('aria-hidden','false');
    show('callFinding',true);
    show('connectedCall',false);
    show('voiceMatchArea',false);
    show('videoControls',mode==='video');
    show('voiceControls',mode==='voice');
    setText('findingRemoteName','Finding someone...');
    setText('findingRemoteMeta',mode==='video'?'Looking for a live user':'Looking for a voice match');
    setText('findingLocalMeta',mode==='video'?'Camera starting...':'Mic starting...');
  }

  function showConnected(){
    show('callFinding',false);
    show('connectedCall',true);
    show('voiceMatchArea',mode==='voice');
    show('videoControls',mode==='video');
    show('voiceControls',mode==='voice');
  }

  function updatePeer(p){
    peer=p||{};
    targetId=peer.a2lId||null;
    const name=peer.displayName||'A2L user',meta=peer.location||peer.ageGroup||'Live user';
    setText('findingRemoteName',name);
    setText('remoteMatchName',name);
    setText('remoteMatchMeta',mode==='video'?'Waiting for video…':'Connecting…');
    setText('voiceRemoteName',name);
    setText('voiceRemoteMeta',meta);
    setText('remoteMatchChipName',name);
    setText('remoteMatchChipMeta',meta);
    setText('remoteMatchAvatar',peer.avatar||'🙂');
    setText('voiceRemoteAvatar',peer.avatar||'🙂');
    profileImage(peer.photoData||peer.avatar,peer.avatar);
    show('matchAddFriend',false);
    setStatus('Match found · connecting…');
  }

  function setupPeer(initiator){
    try{pc?.close();}catch{}
    pc=new RTCPeerConnection(RTC_CONFIG);

    if(stream){
      stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    }

    pc.onicecandidate=e=>{
      if(e.candidate)send({type:'ice',candidate:e.candidate});
    };

    pc.ontrack=e=>{
      const rs=e.streams?.[0];
      if(!rs)return;
      if(mode==='video'){
        const v=$('remoteMatchVideo');
        if(v){
          v.srcObject=rs;
          v.hidden=false;
          v.muted=!speakerOn;
          v.play?.().catch(()=>{});
          show('remoteFallback',false);
        }
      }
      if(mode==='voice'||!rs.getVideoTracks().length){
        if(!remoteAudio){
          remoteAudio=document.createElement('audio');
          remoteAudio.autoplay=true;
          remoteAudio.playsInline=true;
          document.body.appendChild(remoteAudio);
        }
        remoteAudio.srcObject=rs;
        remoteAudio.muted=!speakerOn;
        remoteAudio.play?.().catch(()=>{});
      }
      setStatus('Connected · LIVE');
      show('matchAddFriend',true);
      setText('remoteMatchMeta','Live video');
    };

    pc.onconnectionstatechange=()=>{
      const s=pc?.connectionState;
      if(s==='connected'){
        setStatus('Connected · LIVE');
        show('matchAddFriend',true);
      }else if(s==='connecting'){
        setStatus('Connecting…');
      }else if(s==='disconnected'){
        setStatus('Connection unstable · reconnecting…');
        try{pc.restartIce?.();}catch{}
      }else if(s==='failed'){
        setStatus('Connection failed · end and try again');
      }else if(s==='closed'){
        setStatus('Connection ended');
      }
    };

    pc.oniceconnectionstatechange=()=>{
      if(pc?.iceConnectionState==='failed'){
        try{pc.restartIce?.();}catch{}
      }
    };

    if(initiator)createOffer();
  }
  async function flushPendingIce(){
    if(!pc?.remoteDescription)return;
    while(pendingIce.length > 0) {
      const queued=pendingIce.splice(0);
      for(const cand of queued){
        try{
          await pc.addIceCandidate(cand);
        }catch(e){}
      }
    }
  }

  async function createOffer(){
    if(!pc)return;
    const offer=await pc.createOffer({iceRestart:false});
    await pc.setLocalDescription(offer);
    send({type:'offer',description:pc.localDescription});
  }

  async function handle(m){
    if(m.type==='registered'){
      setStatus('Realtime ready');
      return;
    }
    if(m.type==='waiting'){
      setStatus('Finding someone…');
      return;
    }
    if(m.type==='call-invite'){
      if(peer||pc){
        send({type:'call-busy',to:m.from});
        return;
      }
      const ok=confirm(`${m.fromName||'A2L user'} is calling you for a ${m.kind==='video'?'video':'voice'} call.\n\nAccept?`);
      if(!ok){
        send({type:'call-declined',to:m.from});
        return;
      }
      mode=m.kind||'video';
      source='call';
      peer={a2lId:m.from,displayName:m.fromName||'A2L user',avatar:m.fromAvatar||'🙂',photoData:m.fromPhotoData||''};
      openModal(mode);
      updatePeer(peer);
      showConnected();
      setStatus('Call accepted · starting media…');
      try{
        await getMedia(mode);
        send({type:'call-accept',to:m.from,kind:mode});
        setupPeer(false);
      }catch(e){
        setStatus('Microphone/camera permission required');
        send({type:'call-declined',to:m.from});
        stop(false);
      }
      return;
    }
    if(m.type==='call-accept'){
      if(!peer||m.from!==peer.a2lId)return;
      setStatus('Call accepted · connecting…');
      try{
        await getMedia(mode);
        showConnected();
        setupPeer(true);
      }catch(e){
        setStatus('Microphone/camera permission required');
        send({type:'hangup',reason:'media-denied'});
        stop(false);
      }
      return;
    }
    if(m.type==='match-found'){
      mode=m.mode||mode;
      callHistoryId=m.historyId||null;
      updatePeer(m.peer);
      openModal(mode);
      showConnected();
      try{
        await getMedia(mode);
        setupPeer(Boolean(m.initiator));
      }catch(e){
        setStatus('Microphone/camera permission required');
        send({type:'hangup',reason:'media-denied'});
        stop(false);
      }
      return;
    }
    if(m.type==='offer'){
      if(!pc){
        try{
          await getMedia(mode);
          setupPeer(false);
        }catch{return;}
      }
      await pc.setRemoteDescription(m.description);
      await flushPendingIce();
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({type:'answer',description:pc.localDescription});
      return;
    }
    if(m.type==='answer'){
      if(pc){
        await pc.setRemoteDescription(m.description);
        await flushPendingIce();
      }
    }
    if(m.type==='ice'){
      if(pc?.remoteDescription){
        pc.addIceCandidate(m.candidate).catch(()=>{});
      }else{
        pendingIce.push(m.candidate);
      }
      return;
    }
    if(m.type==='reaction'){
      renderReaction(m.emoji);
      return;
    }
    if(m.type==='hangup'){
      setStatus('Other user ended the call');
      stop(false);
      return;
    }
    if(m.type==='call-declined'){
      setStatus('Call declined');
      setTimeout(()=>stop(false),900);
      return;
    }
    if(m.type==='call-busy'){
      setStatus('User is busy');
      setTimeout(()=>stop(false),900);
      return;
    }
    if(m.type==='call-unavailable'){
      setStatus('User is unavailable');
      setTimeout(()=>stop(false),900);
      return;
    }
    if(m.type==='call-blocked'){
      setStatus('Call unavailable');
      setTimeout(()=>stop(false),900);
      return;
    }
  }

  async function find(prefs,src='quick'){
    await connect();
    mode=prefs?.mode&&prefs.mode!=='any'?prefs.mode:'video';
    source=src;
    targetId=null;
    peer=null;
    callHistoryId=null;
    openModal(mode);
    setStatus('Finding someone…');
    ensureMedia(mode).catch(()=>{});

    const wait=()=>{
      if(window.a2lRealtime?.connected?.())send({type:'find-match',prefs:prefs||{mode}});
      else setTimeout(wait,150);
    };
    wait();
  }

  async function startMatch(kind,id,src){
    mode=kind;
    source=src||'call';
    targetId=id;
    await connect();
    if(source!=='call')return find({mode:kind,language:'any',age:'same',interest:'any',online:true},source);

    openModal(kind);
    const f=(typeof friends!=='undefined')?friends.find(x=>Number(x.id)===Number(id)||x.a2lId===id):null;
    peer={a2lId:findA2LId(id),displayName:f?.name||'A2L user',avatar:f?.avatar||'🙂',photoData:f?.photoData||''};
    updatePeer(peer);
    setStatus('Calling…');
    ensureMedia(kind).catch(()=>{});

    const to=findA2LId(id);
    if(!to){setStatus('User unavailable');return;}
    const wait=()=>{
      if(window.a2lRealtime?.connected?.())send({type:'call-invite',to,kind,source});
      else setTimeout(wait,150);
    };
    wait();
  }

  function findA2LId(id){
    const f=(typeof friends!=='undefined')?friends.find(x=>Number(x.id)===Number(id)):null;
    return f?.a2lId||String(id||'');
  }

  function nextMatch(){
    send({type:'cancel-match'});
    cleanupPeer();
    peer=null;
    setStatus('Finding another user…');
    find({mode,language:'any',age:'same',interest:'any',online:true},'quick');
  }

  function toggleMute(){
    if(!stream)return;
    muted=!muted;
    stream.getAudioTracks().forEach(t=>t.enabled=!muted);
    setText('matchMute',muted?'🔇':'🎙️');
    setText('voiceMute',muted?'🔇':'🎙️');
    setText('localMatchMeta',`Camera ${cameraOn?'on':'off'} · Mic ${muted?'off':'on'}`);
    setText('voiceLocalMeta',`Mic ${muted?'off':'on'} · listening`);
  }

  function toggleCamera(){
    if(mode!=='video'||!stream)return;
    cameraOn=!cameraOn;
    stream.getVideoTracks().forEach(t=>t.enabled=cameraOn);
    show('localMatchVideo',cameraOn);
    show('localFallback',!cameraOn);
    setText('matchCamera',cameraOn?'📹':'🚫');
    setText('localMatchMeta',`Camera ${cameraOn?'on':'off'} · Mic ${muted?'off':'on'}`);
  }

  async function switchCamera(){
    if(mode!=='video'||!cameraOn||!navigator.mediaDevices?.getUserMedia)return;
    const next=facing==='user'?'environment':'user';
    try{
      const ns=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:next}});
      const nt=ns.getVideoTracks()[0],old=stream?.getVideoTracks()[0],sender=pc?.getSenders().find(s=>s.track?.kind==='video');
      if(sender)await sender.replaceTrack(nt);
      if(old){old.stop();stream.removeTrack(old);}
      stream.addTrack(nt);
      const lv=$('localMatchVideo');
      if(lv)lv.srcObject=stream;
      facing=next;
      toastSafe(facing==='user'?'Front camera':'Back camera');
    }catch{
      toastSafe('Could not switch camera');
    }
  }

  function toggleSpeaker(){
    speakerOn=!speakerOn;
    const v=$('remoteMatchVideo');
    if(v)v.muted=!speakerOn;
    if(remoteAudio)remoteAudio.muted=!speakerOn;
    setText('matchSpeaker',speakerOn?'🔊':'🔇');
  }

  function renderReaction(emoji){
    const layer=$('matchReactionLayer');
    if(!layer)return;
    const el=document.createElement('span');
    el.className='a2l-live-reaction';
    el.textContent=emoji;
    el.style.left=(25+Math.random()*50)+'%';
    el.style.top=(35+Math.random()*30)+'%';
    layer.appendChild(el);
    setTimeout(()=>el.remove(),1400);
  }

  function react(emoji){
    renderReaction(emoji);
    send({type:'reaction',emoji});
    if($('reactionPicker'))$('reactionPicker').hidden=true;
  }

  async function addFriend(){
    if(!peer)return;
    const f=(typeof friends!=='undefined')?friends.find(x=>x.a2lId===peer.a2lId):null;
    try{
      if(f&&typeof requestConnection==='function'){
        requestConnection(f.id);
        return;
      }
      if(!window.a2lBackend?.friendRequest)throw new Error('Backend is not ready');
      await window.a2lBackend.friendRequest(peer.a2lId);
      toastSafe('Friend request sent 🤝');
    }catch(e){
      toastSafe(e.message||'Could not send friend request');
    }
  }

  async function reportPeer(){
    if(!peer)return;
    const reason=prompt(`Report ${peer.displayName||'this user'}. Reason:`,'Inappropriate behaviour');
    if(reason===null)return;
    try{
      if(!window.a2lBackend?.report)throw new Error('Backend is not ready');
      await window.a2lBackend.report(peer.a2lId,reason,'call');
      toastSafe('Report submitted 🛡️');
    }catch(e){
      toastSafe(e.message||'Could not submit report');
    }
  }

  async function blockPeer(){
    if(!peer)return;
    const name=peer.displayName||'this user';
    if(!confirm(`Block ${name}? They will be removed from discovery and cannot call or message you.`))return;
    try{
      if(!window.a2lBackend?.block)throw new Error('Backend is not ready');
      await window.a2lBackend.block(peer.a2lId);
      const f=(typeof friends!=='undefined')?friends.find(x=>x.a2lId===peer.a2lId):null;
      if(f&&state.blocked&&!state.blocked.includes(f.id))state.blocked.push(f.id);
      save?.();
      toastSafe(`${name} blocked 🛡️`);
      stop(true);
    }catch(e){
      toastSafe(e.message||'Could not block user');
    }
  }

  function openMore(){
    if(!peer)return;
    const m=$('matchMoreModal');
    if(m){
      setText('matchMoreSub',`Safety and connection options for ${peer.displayName||'this user'}`);
      m.classList.add('show');
      m.setAttribute('aria-hidden','false');
    }
  }

  function cleanupPeer(){
    try{pc?.close();}catch{}
    pc=null;
    pendingIce=[];
    if(remoteAudio){
      remoteAudio.srcObject=null;
      remoteAudio.remove();
      remoteAudio=null;
    }
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream=null;
    }
    const lv=$('localMatchVideo'),rv=$('remoteMatchVideo');
    if(lv){lv.srcObject=null;lv.hidden=false;}
    if(rv){rv.srcObject=null;rv.hidden=true;}
    show('remoteFallback',true);
    show('localFallback',true);
    show('matchAddFriend',false);
  }

  function stop(notify=true){
    if(notify&&peer)send({type:'hangup',reason:'user-ended'});
    cleanupPeer();
    targetId=null;
    peer=null;
    callHistoryId=null;
    muted=false;
    cameraOn=true;
    speakerOn=true;
    mediaPromise = null;
    show('callFinding',true);
    show('connectedCall',false);
    if($('reactionPicker'))$('reactionPicker').hidden=true;
    const m=$('matchSessionModal');
    m?.classList.remove('show');
    m?.setAttribute('aria-hidden','true');
    setStatus('Realtime ready');
  }

  function switchMode(){
    const next=mode==='video'?'voice':'video';
    if(peer)send({type:'hangup',reason:'mode-switch'});
    cleanupPeer();
    peer=null;
    find({mode:next,language:'any',age:'same',interest:'any',online:true},source);
  }

  window.addEventListener('a2l:ws-message',e=>{
    Promise.resolve(handle(e.detail)).catch(err=>setStatus(err.message||'Realtime error'));
  });

  document.addEventListener('DOMContentLoaded',()=>{
    connect().catch(()=>{});
    $('startVideoCall')?.addEventListener('click',()=>{closeModal('chatCallModal');startMatch('video',window.__a2lCallTargetId,'call');});
    $('startVoiceCall')?.addEventListener('click',()=>{closeModal('chatCallModal');startMatch('voice',window.__a2lCallTargetId,'call');});
    $('chatCallClose')?.addEventListener('click',()=>closeModal('chatCallModal'));
    $('matchEnd')?.addEventListener('click',()=>stop(true));
    $('voiceEnd')?.addEventListener('click',()=>stop(true));
    $('cancelFinding')?.addEventListener('click',()=>stop(true));
    $('matchMute')?.addEventListener('click',toggleMute);
    $('voiceMute')?.addEventListener('click',toggleMute);
    $('matchCamera')?.addEventListener('click',toggleCamera);
    $('matchSwitchCamera')?.addEventListener('click',switchCamera);
    $('matchSpeaker')?.addEventListener('click',toggleSpeaker);
    $('voiceVideoSwitch')?.addEventListener('click',switchMode);
    $('matchReaction')?.addEventListener('click',()=>{$('reactionPicker').hidden=!$('reactionPicker').hidden;});
    $('voiceReaction')?.addEventListener('click',()=>{$('reactionPicker').hidden=!$('reactionPicker').hidden;});
    qsa('#reactionPicker button').forEach(b=>b.addEventListener('click',()=>react(b.textContent)));
    $('matchAddFriend')?.addEventListener('click',addFriend);
    $('matchConnectBottom')?.addEventListener('click',addFriend);
    $('matchProfileChip')?.addEventListener('click',openMore);
    $('matchMoreClose')?.addEventListener('click',()=>closeModal('matchMoreModal'));
    $('matchReport')?.addEventListener('click',()=>{closeModal('matchMoreModal');reportPeer();});
    $('matchBlock')?.addEventListener('click',()=>{closeModal('matchMoreModal');blockPeer();});
    $('matchConnect')?.addEventListener('click',()=>{closeModal('matchMoreModal');addFriend();});
  });

  window.a2lCall={
    find,
    startMatch,
    next:nextMatch,
    end:stop,
    reset:()=>stop(false),
    showCallModal:(name,id)=>{
      window.__a2lCallTargetId=id;
      openModal('voice');
    }
  };
})();
