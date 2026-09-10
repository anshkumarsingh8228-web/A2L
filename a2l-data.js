/* A2L production persistence. Supabase is the source of truth; localStorage is cache only. */
(() => {
  'use strict';
  let client=null,userId=null;
  const esc=v=>String(v??'');
  const getClient=()=>client||window.a2lSupabase||null;
  const ready=()=>!!(getClient()&&userId);
  const currentProfile=()=>window.state?.profile||{};
  function hydrate(row){
    if(!row||!window.state)return;
    const p=window.state.profile||{};
    p.displayName=row.display_name||p.displayName||'You';
    p.a2lId=row.username||p.a2lId;
    p.bio=row.bio||p.bio||'';
    p.ageGroup=row.age_group||p.ageGroup||'';
    p.interests=Array.isArray(row.interests)?row.interests:[];
    p.languages=Array.isArray(row.languages)?row.languages:[];
    if(row.avatar_url&&!String(row.avatar_url).startsWith('data:')){p.avatar_url=row.avatar_url;p.avatar=row.avatar_url;delete p.photoData;}
    window.state.profile=p;
    try{localStorage.setItem('aloneToLoneState',JSON.stringify(window.state));}catch(_){ }
    window.dispatchEvent(new CustomEvent('a2l:profile-synced',{detail:row}));
    if(typeof renderProfile==='function')renderProfile();
  }
  function profileRow(){
    const p=currentProfile();
    return {
      id:userId,
      username:esc(p.a2lId).replace(/^@/,'').slice(0,20),
      display_name:esc(p.displayName||'A2L user').slice(0,80),
      avatar_url:esc(p.avatar_url||'').slice(0,2000),
      bio:esc(p.bio||'').slice(0,240),
      age_group:esc(p.ageGroup||'').slice(0,30),
      interests:Array.isArray(p.interests)?p.interests.slice(0,10):[],
      languages:Array.isArray(p.languages)?p.languages.slice(0,6):[],
      plan:window.state?.premium?'premium':'free'
    };
  }
  async function loadProfile(){
    if(!ready())return {skipped:true};
    const {data,error}=await client.from('profiles').select('id,username,display_name,avatar_url,bio,age_group,interests,languages,plan').eq('id',userId).maybeSingle();
    if(error)return {error};
    if(data)hydrate(data);else await saveProfile();
    return {data};
  }
  async function saveProfile(){
    if(!ready())return {skipped:true};
    const row=profileRow();
    const {data,error}=await client.from('profiles').upsert(row,{onConflict:'id'}).select().single();
    if(error)return {error};
    if(data)hydrate(data);
    return {data};
  }
  async function uploadAvatar(dataUrl){
    if(!ready()||!dataUrl||!String(dataUrl).startsWith('data:'))return {skipped:true};
    try{
      const blob=await (await fetch(dataUrl)).blob();
      const path=`${userId}/avatar.jpg`;
      const {error}=await client.storage.from('a2l-avatars').upload(path,blob,{contentType:'image/jpeg',upsert:true,cacheControl:'3600'});
      if(error)return {error};
      const {data}=client.storage.from('a2l-avatars').getPublicUrl(path);
      const url=data?.publicUrl||'';
      if(!url)return {error:new Error('Avatar URL was not returned by Supabase Storage.')};
      window.state.profile.avatar_url=url;window.state.profile.avatar=url;delete window.state.profile.photoData;
      await saveProfile();
      return {url};
    }catch(error){return {error};}
  }
  async function directory(search=''){
    if(!ready())return [];
    let q=client.from('profiles').select('id,username,display_name,avatar_url,bio,age_group,interests,languages,plan').neq('id',userId).limit(100);
    const term=String(search||'').trim().replace(/^@/,'');
    if(term){const safeTerm=term.replace(/[,%()]/g,' ').trim(); if(safeTerm) q=q.or(`username.ilike.%${safeTerm}%,display_name.ilike.%${safeTerm}%`);}
    const {data,error}=await q;
    if(error)return [];
    return (data||[]).map(r=>({userId:String(r.id),authUserId:String(r.id),a2lId:String(r.username||''),name:String(r.display_name||'A2L user'),avatar:r.avatar_url||'🙂',avatar_url:r.avatar_url||'',bio:String(r.bio||''),ageGroup:r.age_group||'',interests:Array.isArray(r.interests)?r.interests:[],languages:Array.isArray(r.languages)?r.languages:[],online:false,isFriend:false}));
  }
  async function refreshDirectory(search=''){const rows=await directory(search);window.a2lSocial?.mergeDirectory?.(rows);return rows;}
  async function saveFriendRequest(row){
    if(!ready())return {skipped:true};
    return client.from('friend_requests').insert({sender_id:userId,receiver_id:String(row.receiverId||row.to||row.userId),status:'pending'}).select().single();
  }
  async function updateFriendRequest(id,status){if(!ready())return {skipped:true};return client.from('friend_requests').update({status,updated_at:new Date().toISOString()}).eq('id',id).select().maybeSingle();}
  async function loadFriendships(){if(!ready())return [];const {data,error}=await client.from('friendships').select('id,user_a,user_b,created_at').or(`user_a.eq.${userId},user_b.eq.${userId}`);return error?[]:(data||[]);}
  async function loadFriendRequests(){if(!ready())return [];const {data,error}=await client.from('friend_requests').select('id,sender_id,receiver_id,status,created_at,updated_at').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order('created_at',{ascending:false});return error?[]:(data||[]);}
  async function createFriendship(otherId){if(!ready())return {skipped:true};const other=String(otherId),a=userId<other?userId:other,b=userId<other?other:userId;return client.from('friendships').upsert({user_a:a,user_b:b},{onConflict:'user_a,user_b'}).select().single();}
  async function acceptFriendRequest(requestId,senderId){if(!ready())return {skipped:true};if(senderId){const rpc=await client.rpc('accept_a2l_friend_request',{p_request:String(requestId)});if(!rpc.error)return rpc;}return createFriendship(senderId);}
  async function ensureConversation(otherId,kind='direct'){
    if(!ready()||!otherId||String(otherId)===String(userId))return null;
    const peer=String(otherId), conversationKind=String(kind||'direct');
    const primary=await client.rpc('create_a2l_conversation',{p_other:peer,p_kind:conversationKind});
    if(!primary.error&&primary.data)return primary.data;
    const legacy=await client.rpc('create_direct_conversation',{p_other:peer});
    if(!legacy.error&&legacy.data)return legacy.data;
    const created=await client.from('conversations').insert({kind:conversationKind}).select('id').single();
    if(created.error||!created.data?.id)return null;
    const cid=created.data.id;
    const members=await client.from('conversation_members').insert([{conversation_id:cid,user_id:userId},{conversation_id:cid,user_id:peer}]);
    return members.error?null:cid;
  }
  async function loadMessages(conversationId){if(!ready()||!conversationId)return [];let q=await client.from('messages').select('id,conversation_id,sender_id,body,created_at,client_message_id').eq('conversation_id',conversationId).order('created_at',{ascending:true});if(q.error)q=await client.from('messages').select('id,conversation_id,sender_id,body,created_at').eq('conversation_id',conversationId).order('created_at',{ascending:true});return q.error?[]:(q.data||[]);}
  async function persistMessage(conversationId,body,clientMessageId){
    if(!ready()||!conversationId)return {skipped:true};
    let r=await client.from('messages').insert({conversation_id:conversationId,sender_id:userId,body:String(body).slice(0,2000),client_message_id:String(clientMessageId||'')||null}).select().single();
    if(r.error&&/client_message_id/i.test(r.error.message||'')){r=await client.from('messages').insert({conversation_id:conversationId,sender_id:userId,body:String(body).slice(0,2000)}).select().single();}
    return r;
  }
  async function subscribeMessages(conversationId,cb){
    if(!ready()||!conversationId||typeof cb!=='function')return ()=>{};
    const channel=client.channel(`a2l-chat-${conversationId}-${userId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversationId}`},payload=>cb(payload.new));
    const result=await channel.subscribe();
    if(result==='CLOSED'||result==='CHANNEL_ERROR')return ()=>{};
    return ()=>{try{client.removeChannel(channel)}catch(_){}};
  }
  async function init(){
    client=window.a2lSupabase||null;userId=window.a2lAuth?.getUser?.()?.id||null;
    if(!ready())return;
    await loadProfile();
    setTimeout(()=>refreshDirectory(),400);
  }
  window.a2lData={get client(){return getClient()},get userId(){return userId},isReady:ready,loadProfile,saveProfile,uploadAvatar,directory,refreshDirectory,saveFriendRequest,updateFriendRequest,loadFriendships,loadFriendRequests,createFriendship,acceptFriendRequest,ensureConversation,loadMessages,persistMessage,subscribeMessages};
  window.addEventListener('a2l:auth-changed',init);window.addEventListener('a2l:supabase-ready',init);if(window.a2lAuth?.getUser?.())init();
})();
