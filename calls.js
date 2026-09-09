/* Alone2Lone real-time calls: WebRTC media + Socket.IO signaling. */
(function(){
  "use strict";
  let stream=null,pc=null,targetId=null,mode=null,source="call",facing="user",muted=false,cameraOn=true;
  let audioCtx=null,analyser=null,raf=0,callPeerA2LId=null,initiator=false;

  const friend=()=>friends.find(f=>Number(f.id)===Number(targetId));
  const setText=(id,t)=>{const x=$(id);if(x)x.textContent=t};
  const online=()=>!!friend()?.online;
  const canCall=()=>online();

  function showChooser(nameOrId,idMaybe){
    const id=idMaybe===undefined?nameOrId:idMaybe;targetId=Number(id);
    const f=friend();
    setText('chatCallTitle',`Call ${f?.name||'user'}`);
    setText('chatCallSub',online()?'Choose voice or video.':'This user is offline.');
    const c=$('callChooser');if(c)c.hidden=!online();
    setText('callHint',online()?'Calls are online-only. Live media is not recorded or stored.':'Offline users do not receive queued calls.');
    openModal('chatCallModal');
  }

  async function getMedia(kind){
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera/microphone access is not supported here.');
    return navigator.mediaDevices.getUserMedia(
      kind==='video'?{audio:true,video:{facingMode:facing}}:{audio:true,video:false}
    );
  }

  function setPresence(status){
    state.liveStatus=status;save();
    if(window.a2lSocket?.connected) window.a2lSocket.emit("presence:set",{status});
    try{
      localStorage.setItem("a2lPresence_"+state.profile.a2lId,JSON.stringify({status,at:Date.now()}));
    }catch(_e){}
  }

  function closeCall(){
    if(window.a2lSocket?.connected && callPeerA2LId){
      window.a2lSocket.emit("call:signal",{to:callPeerA2LId,type:"hangup"});
    }
    setPresence("online");
    cancelAnimationFrame(raf);raf=0;
    if(audioCtx){audioCtx.close().catch(()=>{});audioCtx=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
    if(pc){try{pc.ontrack=null;pc.close()}catch(_e){}pc=null}
    targetId=null;mode=null;source="call";muted=false;cameraOn=true;callPeerA2LId=null;initiator=false;
    const m=$('matchSessionModal');if(m){m.classList.remove('show');m.setAttribute('aria-hidden','true')}
    if($('reactionPicker'))$('reactionPicker').hidden=true;
  }

  function renderBase(kind,id,src){
    const f=friend();
    setText('matchSessionTitle',kind==='video'?'Video Match':'Voice Match');
    setText('matchSessionStatus',src==='quick'?'Quick Match · LIVE':src==='vibe'?'Find Your Vibe · LIVE':'Live call · LIVE');
    setText('remoteMatchName',f?.name||'A2L user');setText('remoteMatchAvatar',f?.avatar||'🙂');
    setText('voiceRemoteName',f?.name||'A2L user');setText('voiceRemoteAvatar',f?.avatar||'🙂');
    setText('localMatchAvatar',state.profile.avatar||'💻');setText('voiceLocalAvatar',state.profile.avatar||'💻');
    $('videoMatchArea').hidden=kind!=='video';$('voiceMatchArea').hidden=kind!=='voice';
    $('videoControls').hidden=kind!=='video';$('voiceControls').hidden=kind!=='voice';
    $('remoteFallback').hidden=false;$('remoteMatchVideo').hidden=true;
    $('localFallback').hidden=kind==='video';$('localMatchVideo').hidden=kind!=='video';
    const modal=$('matchSessionModal');modal.classList.add('show');modal.setAttribute('aria-hidden','false');
  }

  function setupAudioMeter(){
    if(!stream?.getAudioTracks().length)return;
    try{
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const src=audioCtx.createMediaStreamSource(stream);analyser=audioCtx.createAnalyser();analyser.fftSize=256;src.connect(analyser);
      const data=new Uint8Array(analyser.frequencyBinCount);
      const tick=()=>{
        if(!analyser)return;
        analyser.getByteFrequencyData(data);let sum=0;for(const n of data)sum+=n;
        const level=Math.min(1,sum/data.length/80);
        $('localAudioRing')?.style.setProperty('--audio-level',String(level));
        raf=requestAnimationFrame(tick);
      };tick();
    }catch(_e){}
  }

  function makePeer(){
    if(!window.RTCPeerConnection) throw new Error("WebRTC is not supported in this browser.");
    pc=new RTCPeerConnection({
      iceServers:[
        {urls:"stun:stun.l.google.com:19302"},
        {urls:"stun:stun.cloudflare.com:3478"}
      ]
    });
    stream?.getTracks().forEach(t=>pc.addTrack(t,stream));
    pc.onicecandidate=e=>{
      if(e.candidate && callPeerA2LId && window.a2lSocket?.connected)
        window.a2lSocket.emit("call:signal",{to:callPeerA2LId,type:"ice",candidate:e.candidate});
    };
    pc.ontrack=e=>{
      const remote=e.streams?.[0];if(!remote)return;
      if(mode==="video"){
        const v=$('remoteMatchVideo');if(v){v.srcObject=remote;v.hidden=false}
        $('remoteFallback').hidden=true;
      }else{
        let audio=$('a2lRemoteAudio');
        if(!audio){audio=document.createElement("audio");audio.id="a2lRemoteAudio";audio.autoplay=true;audio.playsInline=true;document.body.appendChild(audio)}
        audio.srcObject=remote;
        setText('voiceRemoteMeta','Connected · audio live');
      }
    };
    pc.onconnectionstatechange=()=>{
      if(!pc)return;
      if(pc.connectionState==="connected")setText('matchSessionStatus','Connected · LIVE');
      if(["failed","disconnected"].includes(pc.connectionState))setText('matchSessionStatus','Connection unstable');
      if(pc.connectionState==="closed")setText('matchSessionStatus','Connection ended');
    };
  }

  async function createOffer(){
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.a2lSocket?.emit("call:signal",{to:callPeerA2LId,type:"offer",sdp:pc.localDescription});
  }

  async function handleSignal(m){
    if(!m || String(m.from||"")!==String(callPeerA2LId||"")) return;
    try{
      if(m.type==="answer" && pc){
        await pc.setRemoteDescription(m.sdp);
        return;
      }
      if(m.type==="offer"){
        if(!pc) return;
        await pc.setRemoteDescription(m.sdp);
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        window.a2lSocket?.emit("call:signal",{to:callPeerA2LId,type:"answer",sdp:pc.localDescription});
        return;
      }
      if(m.type==="ice" && pc && m.candidate){
        try{await pc.addIceCandidate(m.candidate)}catch(_e){}
        return;
      }
      if(m.type==="hangup"){
        closeCall();return;
      }
    }catch(e){
      setText('matchSessionStatus','Call connection error');
    }
  }

  async function startMatch(kind,id,src){
    targetId=Number(id);source=src||"call";
    const f=friend();
    if(!f){toast("User profile is unavailable.");targetId=null;return;}
    if(!canCall()){toast("User is offline — no call was sent.");targetId=null;return;}
    if(!window.a2lSocket?.connected){toast("Connecting to call server…");return;}
    mode=kind;callPeerA2LId=String(f.a2lId);initiator=true;
    setPresence(source==="quick"?"quick_match":"in_call");renderBase(kind,id,source);
    setText('matchSessionStatus',`Starting ${kind}…`);
    try{
      stream=await getMedia(kind);
      if(kind==="video"){
        const v=$('localMatchVideo');v.srcObject=stream;v.hidden=false;$('localFallback').hidden=true;
        setText('localMatchMeta','Camera on · Mic on');
      }else{
        setText('voiceLocalMeta','Mic on · listening');setupAudioMeter();
      }
      makePeer();
      window.a2lSocket.emit("call:invite",{
        to:callPeerA2LId,kind,source,
        fromName:state.profile.displayName,fromAvatar:state.profile.avatar
      });
      await createOffer();
      setText('matchSessionStatus',"Calling…");
    }catch(e){toast(e.message||"Camera/microphone permission is required.");closeCall();}
  }

  async function acceptIncoming(m){
    targetId=Number(m.localPeerId||0);
    if(!targetId && Array.isArray(friends)){
      const f=friends.find(x=>String(x.a2lId)===String(m.from));
      targetId=Number(f?.id||0);
    }
    callPeerA2LId=String(m.from);mode=m.kind==="video"?"video":"voice";source=m.source||"call";initiator=false;
    setPresence(source==="quick"?"quick_match":"in_call");renderBase(mode,targetId,source);
    setText('matchSessionStatus',`Connecting ${mode}…`);
    try{
      stream=await getMedia(mode);
      if(mode==="video"){
        const v=$('localMatchVideo');v.srcObject=stream;v.hidden=false;$('localFallback').hidden=true;
        setText('localMatchMeta','Camera on · Mic on');
      }else{setText('voiceLocalMeta','Mic on · listening');setupAudioMeter();}
      makePeer();
      window.a2lSocket.emit("call:accept",{to:callPeerA2LId});
    }catch(e){toast(e.message||"Camera/microphone permission is required.");window.a2lSocket?.emit("call:reject",{to:callPeerA2LId});closeCall();}
  }

  function toggleMute(){
    if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);
    setText('matchMute',muted?'🔇':'🎙️');setText('voiceMute',muted?'🔇':'🎙️');
    setText('voiceLocalMeta',muted?'Mic muted':'Mic on · listening');
  }
  function toggleCamera(){
    if(mode!=="video")return;cameraOn=!cameraOn;
    stream?.getVideoTracks().forEach(t=>t.enabled=cameraOn);
    $('localMatchVideo').hidden=!cameraOn;$('localFallback').hidden=cameraOn;
    setText('matchCamera',cameraOn?'📹':'🚫');
    setText('localMatchMeta',cameraOn?'Camera on · Mic '+(muted?'off':'on'):'Camera off · voice continues');
  }
  async function switchCamera(){
    if(mode!=="video"||!cameraOn)return;facing=facing==="user"?"environment":"user";
    try{
      const ns=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:facing}});
      const nt=ns.getVideoTracks()[0],old=stream?.getVideoTracks()[0];
      if(old){stream.removeTrack(old);old.stop()}stream?.addTrack(nt);
      const sender=pc?.getSenders().find(s=>s.track?.kind==="video");if(sender)await sender.replaceTrack(nt);
      $('localMatchVideo').srcObject=stream;toast(facing==="user"?"Front camera":"Back camera");
    }catch(_e){toast("Could not switch camera.");}
  }
  function switchMode(){const next=mode==="video"?"voice":"video";closeCall();setTimeout(()=>startMatch(next,targetId,source),100)}
  function react(emoji){
    const layer=$('matchReactionLayer');if(!layer)return;
    const el=document.createElement('span');el.className='a2l-live-reaction';el.textContent=emoji;
    el.style.left=(25+Math.random()*50)+"%";el.style.top=(55+Math.random()*20)+"%";
    layer.appendChild(el);setTimeout(()=>el.remove(),1200);
    if($('reactionPicker'))$('reactionPicker').hidden=true;
  }
  function more(){openModal('matchMoreModal');setText('matchMoreSub',friend()?`Options for ${friend().name}`:'Safety and connection options')}
  function addFriend(){if(targetId)requestConnection(Number(targetId))}

  window.addEventListener("a2l:call-signal",e=>handleSignal(e.detail));

  function onCallInvite(m){
    if(!m || !window.a2lSocket)return;
    const cp=state.privacy||{};
    const f=friends.find(x=>String(x.a2lId)===String(m.from));
    const connected=(state.connections||[]).map(Number).includes(Number(f?.id));
    if(cp.call==="nobody" || (cp.call==="connected" && !connected)){
      window.a2lSocket.emit("call:reject",{to:m.from});return;
    }
    if(state.liveStatus==="in_call"||state.liveStatus==="quick_match"){
      window.a2lSocket.emit("call:busy",{to:m.from});return;
    }
    const accept=confirm(`${m.fromName||"A2L user"} is calling you for a ${m.kind==="video"?"video":"voice"} call.\n\nAccept?`);
    if(accept) acceptIncoming({...m,localPeerId:Number(f?.id||0)});
    else window.a2lSocket.emit("call:reject",{to:m.from});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    setPresence('online');
    window.addEventListener('beforeunload',()=>{try{localStorage.removeItem("a2lPresence_"+state.profile.a2lId)}catch(_e){}});
    if(window.a2lSocket) window.a2lSocket.on("call:invite",onCallInvite);
    if(window.a2lSocket) window.a2lSocket.on("call:busy",()=>setText("matchSessionStatus","User is busy"));
    if(window.a2lSocket) window.a2lSocket.on("call:reject",()=>setText("matchSessionStatus","Call declined"));
    if(window.a2lSocket) window.a2lSocket.on("call:accepted",()=>setText("matchSessionStatus","Connecting…"));
    $('startVideoCall')?.addEventListener('click',()=>{closeModal('chatCallModal');startMatch('video',targetId,'call')});
    $('startVoiceCall')?.addEventListener('click',()=>{closeModal('chatCallModal');startMatch('voice',targetId,'call')});
    $('chatCallClose')?.addEventListener('click',()=>closeModal('chatCallModal'));
    $('matchEnd')?.addEventListener('click',closeCall);$('voiceEnd')?.addEventListener('click',closeCall);$('matchBack')?.addEventListener('click',closeCall);
    $('matchMute')?.addEventListener('click',toggleMute);$('voiceMute')?.addEventListener('click',toggleMute);
    $('matchCamera')?.addEventListener('click',toggleCamera);$('matchSwitchCamera')?.addEventListener('click',switchCamera);
    $('matchVoiceSwitch')?.addEventListener('click',switchMode);$('voiceVideoSwitch')?.addEventListener('click',switchMode);
    $('matchReaction')?.addEventListener('click',()=>{$('reactionPicker').hidden=!$('reactionPicker').hidden});
    $('voiceReaction')?.addEventListener('click',()=>{$('reactionPicker').hidden=!$('reactionPicker').hidden});
    qsa('#reactionPicker button').forEach(b=>b.addEventListener('click',()=>react(b.textContent)));
    $('matchMore')?.addEventListener('click',more);$('matchMoreClose')?.addEventListener('click',()=>closeModal('matchMoreModal'));
    $('matchConnect')?.addEventListener('click',()=>{closeModal('matchMoreModal');addFriend()});
    $('matchReport')?.addEventListener('click',()=>{closeModal('matchMoreModal');if(targetId)reportPerson(targetId)});
    $('matchBlock')?.addEventListener('click',()=>{const id=targetId;closeModal('matchMoreModal');if(id)blockPerson(id);closeCall()});
    $('matchAddFriend')?.addEventListener('click',addFriend);$('voiceAddFriend')?.addEventListener('click',addFriend);
  });
  window.a2lCall={showCallModal:showChooser,startMatch,reset:closeCall};
})();
