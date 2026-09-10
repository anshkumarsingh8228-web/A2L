/* A2L realtime chat bridge: one primary socket, persistent Supabase history, friend + stranger chat. */
(() => {
  'use strict';
  const listeners=new Set();
  const emit=m=>listeners.forEach(fn=>{try{fn(m)}catch(_){}});
  function state(){return window.state||{};}
  function stableId(s){let h=2166136261;for(const ch of String(s||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return -Math.max(1000,Math.abs(h|0));}
  function upsertPeer(profile,peerId,kind){
    const uid=String(peerId||profile?.authUserId||profile?.userId||''); if(!uid)return null;
    const f=(window.friends||[]).find(x=>String(x.userId||'')===uid||String(x.authUserId||'')===uid||String(x.a2lId||'').toLowerCase()===String(profile?.a2lId||'').toLowerCase());
    const row=f||{id:stableId(uid),userId:uid,authUserId:uid,a2lId:profile?.a2lId||uid,name:profile?.name||'A2L user',avatar:profile?.avatar||'🙂',avatar_url:profile?.avatar||'',online:true,isFriend:kind==='friend'};
    Object.assign(row,{userId:uid,authUserId:uid,a2lId:profile?.a2lId||row.a2lId,name:profile?.name||row.name||'A2L user',avatar_url:profile?.avatar_url||profile?.avatar||row.avatar_url||'',avatar:profile?.avatar_url||profile?.avatar||row.avatar||'🙂',online:profile?.online!==false,isFriend:kind==='friend'||row.isFriend});
    if(!f)window.friends?.push(row);
    return row;
  }
  async function ensureConversation(peerId,kind='direct'){
    const data=window.a2lData;if(!data?.isReady?.())return null;
    return data.ensureConversation(peerId,kind);
  }
  async function openMatchedText(detail){
    const peerId=String(detail.peerId||''); if(!peerId)return;
    const f=upsertPeer(detail.peerProfile||{name:detail.peerName||'A2L user'},peerId,'stranger');
    if(!f)return;
    const st=state();const id=f.id;
    const c=st.chats[id]||{messages:[],source:'stranger',ended:false,locked:false,startedAt:Date.now()};
    c.source='stranger';c.ended=false;c.locked=false;c.livePeerId=peerId;c.dbUserId=peerId;st.chats[id]=c;
    const cid=await ensureConversation(peerId,'stranger'); if(cid){c.conversationId=cid;const rows=await window.a2lData.loadMessages(cid);if(rows.length)c.messages=rows.map(m=>({text:m.body,mine:String(m.sender_id)===String(window.a2lData.userId),at:new Date(m.created_at).getTime(),status:String(m.sender_id)===String(window.a2lData.userId)?'read':'received',dbId:m.id,clientMessageId:m.client_message_id||''}));}
    window.save?.();window.renderAll?.();
    if(typeof window.go==='function')window.go('chats');
    if(typeof window.setChatCategory==='function')window.setChatCategory('strangers');
    if(typeof window.openChat==='function')window.openChat(id);
  }
  function findLocalChatByPeer(peerId){return Object.entries(state().chats||{}).find(([_,c])=>String(c?.livePeerId||'')===String(peerId))?.[0]||null;}
  async function processIncoming(m){
    if(m.type==='chat-delivered'){
      const st=state(); Object.values(st.chats||{}).forEach(c=>{(c.messages||[]).forEach(msg=>{if(msg.clientMessageId===m.clientMessageId||msg.id===m.clientMessageId)msg.status='delivered';});}); window.save?.(); if(window.a2lActiveChatId!=null&&window.renderMessages)window.renderMessages(window.a2lActiveChatId); return;
    }
    if(m.type!=='chat-message'||!m.message)return;
    const msg=m.message; const peerId=String(m.from||msg.from||'');
    const profile=m.peerProfile||msg.peerProfile||{name:m.fromName||'A2L user'};
    const f=upsertPeer(profile,peerId,'friend'); if(!f)return;
    const st=state(); let key=findLocalChatByPeer(peerId);
    let c=key?st.chats[key]:null;
    if(!c){key=String(f.id);c=st.chats[key]||{messages:[],source:f.isFriend?'friend':'stranger',ended:false,locked:false,startedAt:Date.now()};st.chats[key]=c;}
    c.ended=false;c.locked=false;c.livePeerId=peerId;c.source=c.source==='stranger'?'stranger':(f.isFriend?'friend':c.source||'stranger');
    if(msg.conversationId)c.conversationId=String(msg.conversationId);
    c.messages=c.messages||[];
    const incomingId=String(msg.id||m.clientMessageId||'');
    const duplicate=c.messages.some(x=>incomingId&&(String(x.clientMessageId||x.id||'')===incomingId));
    if(!duplicate)c.messages.push({text:String(msg.text||m.text||''),mine:false,at:Number(msg.at||Date.now()),status:'received',clientMessageId:incomingId||undefined,dbId:msg.dbId});
    window.save?.(); window.renderAll?.();
    if(window.a2lActiveChatId!=null&&Number(window.a2lActiveChatId)===Number(key)&&typeof window.renderMessages==='function')window.renderMessages(Number(key));
    else if(typeof window.toast==='function')window.toast(`New message from ${f.name} 💬`);
  }
  function connect(){
    window.a2lRealMatch?.onMessage?.(m=>{if(['chat-message','chat-delivered','chat-history','chat-error'].includes(m.type)){processIncoming(m).catch(()=>{});emit(m)}});
  }
  window.addEventListener('a2l:text-match',e=>{openMatchedText(e.detail||{}).catch(err=>window.toast?.(err?.message||'Could not open stranger chat.'));});
  window.a2lChat={
    connect,
    on(fn){if(typeof fn==='function')listeners.add(fn);return()=>listeners.delete(fn)},
    send(conversationId,text,clientMessageId){
      const c=Object.values(state().chats||{}).find(x=>x?.conversationId===String(conversationId));
      const to=c?.livePeerId;if(!to)return false;
      return !!window.a2lRealMatch?.sendRaw?.({type:'chat-message',to,text:String(text).trim().slice(0,2000),conversationId:String(conversationId||''),clientMessageId:clientMessageId||crypto.randomUUID()});
    },
    history(){return true}
  };
  connect();
})();
