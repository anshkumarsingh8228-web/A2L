/* A2L real-user matchmaking + WebRTC bridge. Server matches live browser sessions; media is P2P. */
(function(){
  'use strict';
  let ws=null, stream=null, pc=null, peerId=null, peerName='A2L user', mode='video', initiator=false, iceQueue=[];
  let muted=false, cameraOn=true;
  const $=id=>document.getElementById(id);
  const text=(id,t)=>{const x=$(id);if(x)x.textContent=t};
  const wsUrl=()=> (location.protocol==='https:'?'wss://':'ws://')+location.host;
  function send(m){if(ws&&ws.readyState===1)ws.send(JSON.stringify(m));}
  function connect(){
    if(ws&&[0,1].includes(ws.readyState)) return;
    ws=new WebSocket(wsUrl());
    ws.onopen=()=>send({type:'register',a2lId:state.profile.a2lId,name:state.profile.displayName||'A2L user'});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
    ws.onclose=()=>{ws=null};
  }
  function ensureReady(fn){
    connect();
    if(ws.readyState===1) fn();
    else {const old=ws.onopen; ws.onopen=()=>{send({type:'register',a2lId:state.profile.a2lId,name:state.profile.displayName||'A2L user'});fn();};}
  }
  function show(kind){
    $('videoMatchArea').hidden=kind!=='video'; $('voiceMatchArea').hidden=kind!=='voice';
    $('videoControls').hidden=kind!=='video'; $('voiceControls').hidden=kind!=='voice';
    $('remoteMatchVideo').hidden=true; $('remoteFallback').hidden=false;
    $('localMatchVideo').hidden=kind!=='video'; $('localFallback').hidden=kind==='video';
    text('matchSessionTitle',kind==='video'?'Video Match':'Voice Match');
    text('matchSessionStatus',initiator?'Finding a live user…':'Incoming connection…');
    text('remoteMatchName',peerName); text('voiceRemoteName',peerName);
    $('matchSessionModal')?.classList.add('show'); $('matchSessionModal')?.setAttribute('aria-hidden','false');
  }
  async function media(){
    return navigator.mediaDevices.getUserMedia(mode==='video'?{audio:true,video:{facingMode:'user'}}:{audio:true,video:false});
  }
  function setupPeer(){
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'}]});
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    pc.onicecandidate=e=>{if(e.candidate)send({type:'ice',to:peerId,candidate:e.candidate});};
    pc.ontrack=e=>{const v=$('remoteMatchVideo');if(v){v.srcObject=e.streams[0];v.hidden=mode!=='video';$('remoteFallback').hidden=mode==='video';}};
    pc.onconnectionstatechange=()=>{if(pc?.connectionState==='connected')text('matchSessionStatus','Connected · LIVE');if(['failed','closed'].includes(pc?.connectionState))text('matchSessionStatus','Connection ended');};
  }
  async function flush(){for(const c of iceQueue.splice(0)){try{await pc.addIceCandidate(c)}catch(_){}}}
  async function start(kind,id,name,makeOffer){
    mode=kind||'video'; peerId=id; peerName=name||'A2L user'; initiator=!!makeOffer; show(mode);
    try{
      stream=await media();
      if(mode==='video'){$('localMatchVideo').srcObject=stream;$('localMatchVideo').hidden=false;$('localFallback').hidden=true;text('localMatchMeta','Camera on · Mic on');}
      else text('voiceLocalMeta','Mic on · listening');
      setupPeer();
      if(initiator){
        const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
        send({type:'offer',to:peerId,sdp:offer,kind:mode,source:'real-match'});
      }
    }catch(e){toast(e.message||'Camera/microphone permission is required.');end(false);}
  }
  async function handle(m){
    if(m.type==='registered'||m.type==='replaced'||m.type==='waiting'){
      if(m.type==='waiting') text('matchSessionStatus','Waiting for another live user…');
      return;
    }
    if(m.type==='match-found'){
      peerId=m.peerId; peerName=m.peerName||'A2L user'; mode=m.mode||mode; initiator=!!m.initiator;
      start(mode,peerId,peerName,initiator); return;
    }
    if(m.type==='offer'){
      peerId=m.from; peerName=m.fromName||'A2L user'; mode=m.kind||'video';
      if(!pc) await start(mode,peerId,peerName,false);
      await pc.setRemoteDescription(m.sdp); await flush();
      const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); send({type:'answer',to:peerId,sdp:ans}); return;
    }
    if(m.type==='answer'&&pc){await pc.setRemoteDescription(m.sdp);await flush();return;}
    if(m.type==='ice'&&pc){if(pc.remoteDescription)try{await pc.addIceCandidate(m.candidate)}catch(_){}else iceQueue.push(m.candidate);return;}
    if(m.type==='hangup'){text('matchSessionStatus','Call ended');setTimeout(()=>end(false),300);}
  }
  function find(kind){
    mode=kind||'video'; connect();
    const run=()=>send({type:'find-match',mode,profile:{name:state.profile.displayName||'A2L user'}});
    if(ws.readyState===1)run(); else ws.addEventListener('open',run,{once:true});
    text('matchSessionStatus','Finding a live user…');
  }
  function end(notify=true){
    if(notify&&peerId)send({type:'hangup',to:peerId});
    send({type:'cancel-match'});
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null} if(pc){try{pc.close()}catch(_){}pc=null}
    peerId=null;peerName='A2L user';initiator=false;iceQueue=[];muted=false;cameraOn=true;
    $('matchSessionModal')?.classList.remove('show');$('matchSessionModal')?.setAttribute('aria-hidden','true');
  }
  function init(){
    connect();
    $('quickMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();find('video');},true);
    $('advancedMatch')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openMatchModal();},true);
    $('matchStart')?.addEventListener('click',e=>{
      e.preventDefault();e.stopImmediatePropagation();
      const selected=$('[data-match-mode].selected')?.dataset.matchMode||'video';
      closeMatchModal();
      if(selected==='text'){toast('Real live text matching is next; video/voice matching is ready.');return;}
      find(selected);
    },true);
    $('matchEnd')?.addEventListener('click',()=>end(true),true); $('voiceEnd')?.addEventListener('click',()=>end(true),true); $('matchBack')?.addEventListener('click',()=>end(true),true);
    $('matchMute')?.addEventListener('click',()=>{if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);text('matchMute',muted?'🔇':'🎙️');},true);
    $('voiceMute')?.addEventListener('click',()=>{if(!stream)return;muted=!muted;stream.getAudioTracks().forEach(t=>t.enabled=!muted);text('voiceMute',muted?'🔇':'🎙️');},true);
    window.a2lRealMatch={find,end};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
