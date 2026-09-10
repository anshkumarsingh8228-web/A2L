/* A2L shared browser identity. Routing uses userId; profile a2lId remains the public handle. */
(() => {
  'use strict';
  const KEY='a2l_device_session_id';
  let id='';
  try { id=sessionStorage.getItem(KEY)||''; } catch (_) {}
  if(!id){
    try { id=crypto.randomUUID(); }
    catch (_) { id='a2l_session_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2); }
    try { sessionStorage.setItem(KEY,id); } catch (_) {}
  }
  window.a2lIdentity={sessionId:id,getSessionId:()=>id};
})();
