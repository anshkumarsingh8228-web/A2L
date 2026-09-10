/* Stable device/session identity. Account identity comes from Supabase Auth when available. */
(function(){
  'use strict';
  const KEY='a2l_device_session_id';
  let id='';
  try{id=localStorage.getItem(KEY)||'';}catch(_){ }
  if(!id){id=(crypto?.randomUUID?.()||('a2l_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)));try{localStorage.setItem(KEY,id);}catch(_){}}
  window.a2lIdentity={sessionId:id,getSessionId:()=>id,getAccountId:()=>window.a2lAuth?.getUser?.()?.id||''};
})();
