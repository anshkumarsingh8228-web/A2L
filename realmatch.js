/* A2L production realtime engine: one live socket, one video-call renderer, no stacked UIs. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const state=window.state;
  let ws=null, reconnectTimer=null, reconnectDelay=1000;
  let stream=null, pc=null, peerId=null, peerName='A2L user', peerProfile=null;
  let mode='video', callSource='random', initiator=false, awaitingAccept=false;
  let muted=false, cameraOn=true, facing='user', iceQueue=[], connectionTimer=null;
  let matchActive=false;
  const external=new Set();
  const EMOJIS=['❤️','😂','😮','👍','👏','🔥','🎉','😍'];
  let lastReactionAt=0;

  function wsUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host;}
  function mySession(){return window.a2lIdentity?.getSessionId?.()||('a2l_'+Math.random().toString(36).slice(2));}
  function myAuth(){return window.a2lAuth?.getUser?.()?.id||'';}
  function meProfile(){
    const p=state?.profile||{};
    return {a2lId:p.a2lId||'',name:p.displayName||'A2L user',avatar:p.avatar_url||p.photoData||p.avatar||'🙂',ageGroup:p.ageGroup||'',languages:p.languages||[],interests:p.interests||[],bio:p.bio||'',status:p.status||'Available to chat'};
  }
  function send(message){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));}
  function setText(id,value){const el=$(id);if(el)el.textContent=value;}
  function setHidden(id,hidden){const el=$(id);if(el)el.hidden=!!hidden;}
  function showModal(){const el=$('matchSessionModal');if(!el)return;el.hidden=false;el.classList.add('show');el.setAttribute('aria-hidden','false');}
  function hideModal(){const el=$('matchSessionModal');if(!el)return;el.classList.remove('show');el.setAttribute('aria-hidden','true');el.hidden=true;}
  function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function register(){
    send({type:'register',sessionId:mySession(),authUserId:myAuth(),accessToken:window.a2lAuth?.getAccessToken?.()||'',name:meProfile().name,profile:meProfile()});
  }
  function connect(){
    if(ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
    clearTimeout(reconnectTimer);
    try{ws=new WebSocket(wsUrl());}catch(_){scheduleReconnect();return;}
    ws.onopen=()=>{reconnectDelay=1000;register();};
    ws.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data)}catch{return;}
      handle(msg);external.forEach(fn=>{try{fn(msg)}catch(_){}});
    };
    ws.onerror=()=>{};
    ws.onclose=()=>{ws=null;if(matchActive&&peerId)setText('matchSessionStatus','Reconnecting…');scheduleReconnect();};
  }
  function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(15000,Math.round(reconnectDelay*1.6));}
  function peerKey(id){return String(id||'');}

  function openVideoFinding(kind, status){
    if(kind!=='video')return;
    matchActive=true; mode='video';
    showModal();
    setText('matchSessionTitle','Video Match');
    setText('matchSessionStatus',status||'Finding…');
    setText('remoteMatchName','Finding someone…');
    setText('remoteMatchId','');
    setText('remoteMatchMeta','Looking for a live user');
    setText('localMatchMeta','Camera starting…');
    setHidden('remoteMatchVideo',true);setHidden('localMatchVideo',true);
    setHidden('remoteFallback',false);setHidden('localFallback',false); setHidden('remoteFallbackImage',true); setHidden('remoteFallbackAvatar',false); if($('remoteFallbackImage'))$('remoteFallbackImage').src='';
    setHidden('matchNext',true); setHidden('remoteUserPill',true);
    $('remotePanel')?.classList.remove('connected');$('localPanel')?.classList.remove('connected');
    $('matchSessionModal')?.classList.remove('is-connected');
    clearTimeout(connectionTimer);
  }
  function updateRemoteIdentity(profile,name){
    peerProfile=profile||{};peerName=name||peerProfile?.name||'A2L user';
    setText('remoteMatchName',peerName);
    const id=peerProfile?.a2lId?('@'+peerProfile.a2lId):'';
    setText('remoteMatchId',id);setText('remotePillName',peerName);setText('remotePillId',id);setText('remoteMatchMeta','Connecting…'); setHidden('remoteUserPill',false);
    if($('remoteFallbackAvatar'))$('remoteFallbackAvatar').textContent=(peerProfile?.avatar||'🙂').startsWith('http')?'A2L':(peerProfile?.avatar||'🙂');
    if(peerProfile?.avatar?.startsWith?.('http')){
      const img=$('remoteFallbackImage');if(img){img.src=peerProfile.avatar;img.hidden=false;}
      setHidden('remoteFallbackAvatar',true);
    } else { setHidden('remoteFallbackAvatar',false); setHidden('remoteFallbackImage',true); }
  }
  function updateLocalIdentity(){
    const p=meProfile();
    setText('localMatchName',p.name||'You');
    setText('localMatchId',p.a2lId?('@'+p.a2lId):'');
  }

  async function getMedia(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera and microphone access is unavailable in this browser.');
    return navigator.mediaDevices.getUserMedia({audio:true,video:{facingMode:facing,width:{ideal:1280},height:{ideal:720}}});
  }
  function setupPeer(){
    pc=new RTCPeerConnection({iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun.cloudflare.com:3478'}
    ]});
    stream?.getTracks().forEach(track=>pc.addTrack(track,stream));
    pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',to:peerId,candidate:e.candidate});};
    pc.ontrack=e=>{
      const v=$('remoteMatchVideo');
      if(!v)return;
      if(e.streams?.[0])v.srcObject=e.streams[0];
      v.hidden=false;setHidden('remoteFallback',true);v.play?.().catch(()=>{});
    };
    pc.onconnectionstatechange=()=>{
      const s=pc?.connectionState;
      if(s==='connected'){
        clearTimeout(connectionTimer);
        setText('matchSessionStatus','Connected · LIVE');
        $('matchSessionModal')?.classList.add('is-connected');
        $('remotePanel')?.classList.add('connected');$('localPanel')?.classList.add('connected');
        setHidden('matchNext',callSource==='random');
        send({type:'match-state',to:peerId,busy:true});
      }else if(s==='disconnected'){
        setText('matchSessionStatus','Reconnecting…');
      }else if(s==='failed'){
        setText('matchSessionStatus','Connection failed');
        try{pc.restartIce()}catch(_){ }
        setTimeout(()=>{if(pc?.connectionState==='failed')end(true)},4000);
      }
    };
    pc.oniceconnectionstatechange=()=>{if(pc?.iceConnectionState==='failed')setText('matchSessionStatus','Network connection failed');};
  }
  async function addQueuedIce(){for(const c of iceQueue.splice(0)){try{await pc?.addIceCandidate(c)}catch(_){}}}

  async function beginPeer(makeOffer){
    try{
      stream=await getMedia();
      const local=$('localMatchVideo');if(local){local.srcObject=stream;local.hidden=false;}
      setHidden('localFallback',true);cameraOn=true;muted=false;
      setText('localMatchMeta','Camera on · Mic on');setText('matchMute','🎙');setText('matchCamera','📹');
      updateLocalIdentity();
      setupPeer();
      if(makeOffer){
        const offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
        await pc.setLocalDescription(offer);
        send({type:'offer',to:peerId,sdp:offer,kind:'video',source:callSource});
      }
      clearTimeout(connectionTimer);
      connectionTimer=setTimeout(()=>{if(pc?.connectionState!=='connected'){setText('matchSessionStatus','Connection timed out');end(true)}},30000);
    }catch(err){
      window.toast?.(err?.message||'Camera/microphone permission is required.');
      end(false);
    }
  }
  async function start(kind,id,name,makeOffer,profile,source){
    if(kind!=='video'){findText();return;}
    end(false);
    mode='video';callSource=source||'random';peerId=peerKey(id);peerName=name||profile?.name||'A2L user';peerProfile=profile||null;initiator=!!makeOffer;awaitingAccept=false;matchActive=true;
    updateRemoteIdentity(peerProfile,peerName);updateLocalIdentity();
    openVideoFinding('video',callSource==='friend-call'?'Calling…':'Connecting…');
    if(peerId)send({type:'match-state',to:peerId,busy:true});
    await beginPeer(!!makeOffer);
  }
  function find(kind='video'){
    if(kind==='text')return findText();
    end(false);mode='video';callSource='random';peerId=null;peerName='A2L user';peerProfile=null;initiator=false;matchActive=true;
    openVideoFinding('video','Finding someone to connect with…');
    connect();
    const go=()=>send({type:'find-match',mode:'video',profile:meProfile()});
    if(ws?.readyState===WebSocket.OPEN)go();else ws?.addEventListener('open',go,{once:true});
  }
  function findText(){
    end(false);mode='text';callSource='random';matchActive=true;connect();
    const go=()=>send({type:'find-match',mode:'text',profile:meProfile()});
    if(ws?.readyState===WebSocket.OPEN)go();else ws?.addEventListener('open',go,{once:true});
    window.toast?.('Finding a stranger to chat…');
  }
  function startDirect(kind,id){
    if(kind!=='video'){toast('Video Match uses the video call interface.');return;}
    const f=(friends||[]).find(x=>String(x.userId||x.a2lId||x.id)===String(id)||String(x.a2lId)===String(id));
    if(!f||!f.isFriend){toast('You can only call an accepted friend.');return;}
    if(!f.online){toast('This friend is offline.');return;}
    peerId=String(f.authUserId||f.userId||f.a2lId);peerName=f.name||'A2L user';peerProfile=f;mode='video';callSource='friend-call';initiator=true;matchActive=true;connect();
    openVideoFinding('video','Calling…');
    const invite=()=>send({type:'call-invite',to:peerId,kind:'video',source:'friend-call',profile:meProfile()});
    if(ws?.readyState===WebSocket.OPEN)invite();else ws?.addEventListener('open',invite,{once:true});
  }
  async function handle(m){
    if(m.type==='registered')return;
    if(m.type==='replaced'){toast('This session was opened somewhere else.');end(false);return;}
    if(m.type==='waiting'){
      if(m.mode==='video'){openVideoFinding('video','Finding someone to connect with…');}
      return;
    }
    if(m.type==='match-timeout'){
      if(m.mode==='text'){matchActive=true;window.toast?.('Still looking for a stranger…');const retry=()=>send({type:'find-match',mode:'text',profile:meProfile()});if(ws?.readyState===WebSocket.OPEN)retry();return;}
      matchActive=true;setText('matchSessionStatus','Looking for another live user…');setText('remoteMatchMeta','Keep this screen open — we are still looking.');const retry=()=>send({type:'find-match',mode:'video',profile:meProfile()});if(ws?.readyState===WebSocket.OPEN)retry();return;
    }
    if(m.type==='match-found'){
      if(m.mode==='text'){
        matchActive=false;
        window.dispatchEvent(new CustomEvent('a2l:text-match',{detail:{peerId:m.peerId,peerName:m.peerName||'A2L user',peerProfile:m.peerProfile||null,initiator:!!m.initiator}}));
        return;
      }
      mode='video';callSource='random';peerId=String(m.peerId);peerName=m.peerName||m.peerProfile?.name||'A2L user';peerProfile=m.peerProfile||null;initiator=!!m.initiator;matchActive=true;
      updateRemoteIdentity(peerProfile,peerName);openVideoFinding('video','Connecting…');
      await beginPeer(initiator);return;
    }
    if(m.type==='call-invite'){
      if(m.kind!=='video'){send({type:'call-declined',to:m.from});return;}
      if(matchActive||pc){send({type:'call-busy',to:m.from});return;}
      const ok=window.confirm(`${m.fromName||m.profile?.name||'A2L user'} is calling you for a video call.\n\nAccept?`);
      if(!ok){send({type:'call-declined',to:m.from});return;}
      peerId=String(m.from);peerName=m.fromName||m.profile?.name||'A2L user';peerProfile=m.profile||null;mode='video';callSource='friend-call';initiator=false;matchActive=true;
      updateRemoteIdentity(peerProfile,peerName);openVideoFinding('video','Connecting…');
      await beginPeer(false);send({type:'call-accept',to:peerId});return;
    }
    if(m.type==='call-accept'&&String(m.from)===String(peerId)){await beginPeer(true);return;}
    if(m.type==='call-declined'){setText('matchSessionStatus','Call declined');setTimeout(()=>end(false),700);return;}
    if(m.type==='call-busy'){setText('matchSessionStatus','User is busy');setTimeout(()=>end(false),900);return;}
    if(m.type==='offer'){
      peerId=String(m.from);peerName=m.fromName||m.peerProfile?.name||peerName;peerProfile=m.peerProfile||peerProfile;mode='video';matchActive=true;
      updateRemoteIdentity(peerProfile,peerName);openVideoFinding('video','Connecting…');
      if(!pc)await beginPeer(false);
      await pc.setRemoteDescription(m.sdp);await addQueuedIce();const answer=await pc.createAnswer();await pc.setLocalDescription(answer);send({type:'answer',to:peerId,sdp:answer});return;
    }
    if(m.type==='answer'&&pc){await pc.setRemoteDescription(m.sdp);await addQueuedIce();return;}
    if(m.type==='ice'){
      if(pc?.remoteDescription)try{await pc.addIceCandidate(m.candidate)}catch(_){ }else iceQueue.push(m.candidate);return;
    }
    if(m.type==='reaction'&&EMOJIS.includes(m.emoji)){showReaction(m.emoji);return;}
    if(m.type==='hangup'){
      setText('matchSessionStatus','Call ended');setTimeout(()=>end(false),350);return;
    }
  }
  function showReaction(emoji){
    const layer=$('matchReactionLayer');if(!layer)return;
    const item=document.createElement('div');item.className='a2l-final-reaction';item.textContent=emoji;layer.appendChild(item);setTimeout(()=>item.remove(),1250);
  }
  function sendReaction(emoji){
    const now=Date.now();if(!peerId||!EMOJIS.includes(emoji)||now-lastReactionAt<350)return;lastReactionAt=now;send({type:'reaction',to:peerId,emoji,at:now});showReaction(emoji);closeReactionPicker();}
  function toggleReactionPicker(){const p=$('matchEmojiPicker');if(p)p.hidden=!p.hidden;}
  function closeReactionPicker(){const p=$('matchEmojiPicker');if(p)p.hidden=true;}
  function buildReactionPicker(){
    const p=$('matchEmojiPicker');if(!p)return;p.innerHTML=EMOJIS.map(e=>`<button type="button" aria-label="React ${safe(e)}">${safe(e)}</button>`).join('');p.querySelectorAll('button').forEach(b=>b.onclick=()=>sendReaction(b.textContent.trim()));
  }
  function toggleMute(){if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);setText('matchMute',muted?'🔇':'🎙');setText('localMatchMeta',cameraOn?`Camera on · Mic ${muted?'muted':'on'}`:`Camera off · Mic ${muted?'muted':'on'}`);}
  function toggleCamera(){if(!stream)return;cameraOn=!cameraOn;stream.getVideoTracks().forEach(t=>t.enabled=cameraOn);setHidden('localMatchVideo',!cameraOn);setHidden('localFallback',cameraOn);setText('matchCamera',cameraOn?'📹':'🚫');setText('localMatchMeta',`Camera ${cameraOn?'on':'off'} · Mic ${muted?'muted':'on'}`);}
  async function switchCamera(){if(!stream||!pc)return;const next=facing==='user'?'environment':'user';try{const ns=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:next,width:{ideal:1280},height:{ideal:720}}});const nt=ns.getVideoTracks()[0];const sender=pc.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(nt);const old=stream.getVideoTracks()[0];if(old){stream.removeTrack(old);old.stop()}stream.addTrack(nt);facing=next;$('localMatchVideo').srcObject=stream;toast(facing==='user'?'Front camera':'Back camera');}catch(_){toast('Could not switch camera on this device.');}}
  function nextMatch(){if(callSource!=='random')return;const nextMode=mode;end(false);setTimeout(()=>find(nextMode),80);}
  function end(notify=true){
    const oldPeer=peerId;
    if(notify&&oldPeer)send({type:'hangup',to:oldPeer});
    if(oldPeer)send({type:'match-state',to:oldPeer,busy:false});
    send({type:'cancel-match'});
    clearTimeout(connectionTimer);iceQueue=[];matchActive=false;
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    if(pc){try{pc.ontrack=null;pc.close()}catch(_){ }pc=null;}
    peerId=null;peerName='A2L user';peerProfile=null;initiator=false;awaitingAccept=false;mode='video';callSource='random';muted=false;cameraOn=true;facing='user';
    const lv=$('localMatchVideo');if(lv)lv.srcObject=null;const rv=$('remoteMatchVideo');if(rv)rv.srcObject=null; setHidden('remoteUserPill',true); $('matchSessionModal')?.classList.remove('is-connected');
    hideModal();closeReactionPicker();const layer=$('matchReactionLayer');if(layer)layer.innerHTML='';
  }
  function init(){
    connect();buildReactionPicker();
    $('matchEnd')?.addEventListener('click',()=>end(true));
    $('matchNext')?.addEventListener('click',nextMatch);
    $('matchMute')?.addEventListener('click',toggleMute);
    $('matchCamera')?.addEventListener('click',toggleCamera);
    $('matchSwitchCamera')?.addEventListener('click',switchCamera);
    $('matchEmoji')?.addEventListener('click',e=>{e.stopPropagation();toggleReactionPicker()});
    document.addEventListener('click',e=>{if(!e.target.closest?.('#matchEmoji,#matchEmojiPicker'))closeReactionPicker()});
    window.a2lRealMatch={find,end,start,startDirect,nextMatch,findText,sendRaw:send,sendReaction,onMessage(fn){if(typeof fn==='function')external.add(fn);return()=>external.delete(fn)},getPeerId:()=>peerId};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
