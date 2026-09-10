const path=require('path');
const fs=require('fs');
const http=require('http');
const express=require('express');
const {WebSocketServer}=require('ws');
const {jwtVerify,createRemoteJWKSet}=require('jose');

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server});
const peers=new Map();
const serverBlocks=new Map();
const accountPlans=new Map();
const serverReports=[];

const SUPABASE_URL=process.env.SUPABASE_URL||'';
const SUPABASE_JWT_ISSUER=SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '';
const SUPABASE_JWKS=SUPABASE_URL ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;

async function verifySupabaseToken(token){
  if(!SUPABASE_JWKS||!SUPABASE_JWT_ISSUER) throw new Error('auth-not-configured');
  const {payload}=await jwtVerify(token,SUPABASE_JWKS,{issuer:SUPABASE_JWT_ISSUER});
  if(!payload.sub) throw new Error('missing-sub');
  return payload;
}
function tokenFromProtocol(m){
  return typeof m.accessToken==='string' ? m.accessToken : '';
}

const profiles=new Map();
const waiting=new Map();

/* Phase 8 chat prototype: messages are retained for at most 7 days.
   Production persistence is supplied by the Supabase schema in supabase/schema.sql. */
const chatMessages=new Map();
const CHAT_RETENTION_MS=7*24*60*60*1000;
function purgeOldChatMessages(){
  const cutoff=Date.now()-CHAT_RETENTION_MS;
  for(const [conversationId,list] of chatMessages){
    const kept=list.filter(m=>m.createdAt>=cutoff);
    if(kept.length) chatMessages.set(conversationId,kept);
    else chatMessages.delete(conversationId);
  }
}
setInterval(purgeOldChatMessages,60*60*1000).unref?.();
purgeOldChatMessages();
function addChatMessage(conversationId,message){
  purgeOldChatMessages();
  const list=chatMessages.get(conversationId)||[];
  list.push(message);
  chatMessages.set(conversationId,list.slice(-500));
}

const friendSets=new Map();
const pendingRequests=new Map();
const MATCH_TIMEOUT_MS=60_000;
const REACTIONS=new Set(['❤️','😂','😮','👍','👏','🔥','🎉','😍']);
const reactionLastAt=new Map();
const REACTION_COOLDOWN_MS=250;

app.get('/api/config',(req,res)=>res.json({
  supabaseUrl:process.env.SUPABASE_URL||'',
  supabaseAnonKey:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||''
}));
app.get('/health',(req,res)=>res.json({ok:true,service:'a2l-realtime'}));
app.get('/',(req,res)=>{
  const file=path.join(__dirname,'index.html');
  if(!fs.existsSync(file))return res.status(404).send('A2L index.html not found');
  const html=fs.readFileSync(file,'utf8');
  res.type('html').send(html);
});
app.get('/css/style.css',(req,res)=>res.sendFile(path.join(__dirname,'style.css')));
app.get('/js/:file',(req,res)=>{
  const allowed=['plans.js','hub.js','app.js','realtime.js','calls.js','games.js','profile.js','matching.js','chat.js','realmatch.js','presence.js','social.js','auth.js'];
  if(!allowed.includes(req.params.file))return res.status(404).end();
  res.sendFile(path.join(__dirname,req.params.file));
});
app.use(express.static(__dirname));

function isPremiumUser(id){
  return accountPlans.get(String(id)) === 'premium';
}
function requirePremium(ws,feature){
  if(isPremiumUser(ws.sessionId)) return true;
  send(ws,{type:'premium-required',feature});
  return false;
}
function isBlocked(a,b){
  const x=serverBlocks.get(a);
  return !!(x&&x.has(b));
}
function blockPair(a,b){
  if(!serverBlocks.has(a)) serverBlocks.set(a,new Set());
  serverBlocks.get(a).add(b);
}
function unblockPair(a,b){
  const s=serverBlocks.get(a);
  if(s) s.delete(b);
}
function send(ws,msg){if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));}
function route(to,msg){const ws=peers.get(to);if(ws)send(ws,msg);}
function isLive(ws){return !!ws&&ws.readyState===1&&!!ws.sessionId;}
function removeFromQueue(ws){for(const [mode,item] of waiting){if(item.ws===ws){clearTimeout(item.timer);waiting.delete(mode);}}}
function safeProfile(p,id,name){p=p||{};return {a2lId:id,name:String(p.name||name||'A2L user').slice(0,80),avatar:String(p.avatar||'🙂').slice(0,12),ageGroup:String(p.ageGroup||'').slice(0,20),languages:Array.isArray(p.languages)?p.languages.slice(0,5):[],interests:Array.isArray(p.interests)?p.interests.slice(0,10):[],bio:String(p.bio||'').slice(0,240),status:String(p.status||'Available to chat').slice(0,80)};}
function publicUser(ws){return {...ws.profile,a2lId:ws.sessionId,online:isLive(ws),inCall:!!ws.busy};}
function publicKnown(id){const ws=peers.get(id), profile=profiles.get(id)||ws?.profile||safeProfile({},id,'A2L user');return {...profile,a2lId:id,online:isLive(ws),inCall:!!ws?.busy};}
function friendSet(id){if(!friendSets.has(id))friendSets.set(id,new Set());return friendSets.get(id);}
function areFriends(a,b){return !!a&&!!b&&friendSet(a).has(b)&&friendSet(b).has(a);}
function sendPresence(){
  const ids=[...profiles.keys()];
  for(const ws of peers.values())if(isLive(ws))send(ws,{type:'presence-list',users:ids.filter(id=>id!==ws.sessionId).map(id=>({...publicKnown(id),isFriend:areFriends(ws.sessionId,id)}))});
}
function sendFriendList(ws){
  const ids=friendSet(ws.sessionId);const list=[];
  for(const id of ids){const f=peers.get(id);if(f)list.push({...publicUser(f),isFriend:true});}
  send(ws,{type:'friend-list',friends:list});
}
function sendFriendState(a,b){const A=peers.get(a),B=peers.get(b);if(A)sendFriendList(A);if(B)sendFriendList(B);sendPresence();}
function queueMatch(ws,mode,name,profile){
  mode=['video','voice'].includes(mode)?mode:'video';removeFromQueue(ws);
  const candidate=waiting.get(mode);
  if(candidate&&isLive(candidate.ws)&&candidate.ws.sessionId!==ws.sessionId){clearTimeout(candidate.timer);waiting.delete(mode);const common={type:'match-found',mode};send(candidate.ws,{...common,peerId:ws.sessionId,peerName:name||'A2L user',peerProfile:profile||null,initiator:true});send(ws,{...common,peerId:candidate.ws.sessionId,peerName:candidate.name||'A2L user',peerProfile:candidate.profile||null,initiator:false});return;}
  const timer=setTimeout(()=>{const current=waiting.get(mode);if(current&&current.ws===ws){waiting.delete(mode);send(ws,{type:'match-timeout',mode});}},MATCH_TIMEOUT_MS);
  waiting.set(mode,{ws,name:name||'A2L user',profile:profile||null,timer,queuedAt:Date.now()});send(ws,{type:'waiting',mode});
}
function sendFriendRequest(ws,m){
  const to=String(m.to||'');if(!to||to===ws.sessionId||!peers.has(to))return;
  if(areFriends(ws.sessionId,to)){send(ws,{type:'friend-response',requestId:m.request?.id,accepted:true,from:to,fromName:peers.get(to)?.name,friend:publicUser(peers.get(to))});return;}
  const req=m.request||{};const id=String(req.id||'fr_'+Date.now());
  const key=`${ws.sessionId}:${to}`;const reverse=`${to}:${ws.sessionId}`;
  if(pendingRequests.has(key))return;
  if(pendingRequests.has(reverse)){send(ws,{type:'friend-response',requestId:id,accepted:true,from:to,fromName:peers.get(to)?.name,friend:publicUser(peers.get(to))});return;}
  const clean={id,from:ws.sessionId,fromName:ws.name,to, status:'pending',at:Date.now(),profile:ws.profile};pendingRequests.set(key,clean);
  route(to,{type:'friend-request',request:clean,from:ws.sessionId,fromName:ws.name});
}
function respondFriend(ws,m){
  const reqId=String(m.requestId||'');let foundKey=null,req=null;
  for(const [key,r] of pendingRequests){if(r.id===reqId&&r.to===ws.sessionId){foundKey=key;req=r;break;}}
  if(!req)return;pendingRequests.delete(foundKey);
  const from=peers.get(req.from);const accepted=!!m.accepted;
  if(accepted){friendSet(ws.sessionId).add(req.from);friendSet(req.from).add(ws.sessionId);}
  send(from,{type:'friend-response',requestId:req.id,accepted,from:ws.sessionId,fromName:ws.name,friend:publicKnown(ws.sessionId)});
  if(accepted)send(ws,{type:'friend-response',requestId:req.id,accepted:true,from:req.from,fromName:req.fromName,friend:publicKnown(req.from)});
  sendFriendState(ws.sessionId,req.from);
}

wss.on('connection',ws=>{
  let sessionId=null;ws.sessionId=null;ws.name='A2L user';ws.busy=false;ws.profile=safeProfile({},'','A2L user');
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.type==='register'&&m.sessionId){
      sessionId=String(m.sessionId);ws.sessionId=sessionId;ws.name=String(m.name||m.profile?.name||'A2L user').slice(0,80);ws.profile=safeProfile(m.profile,sessionId,ws.name);
      profiles.set(sessionId,ws.profile);
      if(peers.has(sessionId)){const previous=peers.get(sessionId);removeFromQueue(previous);send(previous,{type:'replaced'});try{previous.close()}catch(_){} }
      peers.set(sessionId,ws);send(ws,{type:'registered',sessionId});sendFriendList(ws);sendPresence();return;
    }
    if(!sessionId)return;
    if(m.type==='premium-status'){
      send(ws,{type:'premium-status',plan:isPremiumUser(sessionId)?'premium':'free'});
      return;
    }
    if(m.type==='specific-person-search' || m.type==='direct-connection'){
      if(!requirePremium(ws,m.type)) return;
      const target=String(m.targetId||m.to||'');
      if(!target || target===sessionId || isBlocked(sessionId,target) || isBlocked(target,sessionId)){
        send(ws,{type:'direct-connection-error',error:'invalid-target'});
        return;
      }
      const targetWs=peers.get(target);
      if(!targetWs || !isLive(targetWs)){
        send(ws,{type:'direct-connection-error',error:'user-offline'});
        return;
      }
      send(targetWs,{type:'direct-connection-request',from:sessionId,fromName:ws.name,mode:['video','voice'].includes(m.mode)?m.mode:'video'});
      send(ws,{type:'direct-connection-sent',targetId:target});
      return;
    }
    if(m.type==='block-user'){
      const target=String(m.targetId||m.to||'');
      if(!target||target===sessionId)return;
      blockPair(sessionId,target);
      removeFromQueue(ws);
      const targetWs=peers.get(target);
      if(targetWs) {
        removeFromQueue(targetWs);
        if(targetWs.peerId===sessionId) {
          send(targetWs,{type:'blocked-by-peer'});
          targetWs.peerId=null;
          targetWs.busy=false;
        }
      }
      send(ws,{type:'blocked',targetId:target});
      return;
    }
    if(m.type==='unblock-user'){
      const target=String(m.targetId||'');
      if(target) unblockPair(sessionId,target);
      return;
    }
    if(m.type==='report-user'){
      const target=String(m.targetId||'');
      if(!target)return;
      serverReports.push({
        reporterId:sessionId,targetId:target,
        category:String(m.category||'other').slice(0,60),
        details:String(m.details||'').slice(0,1000),
        createdAt:Date.now()
      });
      send(ws,{type:'report-received',targetId:target});
      return;
    }
    if(m.type==='find-match'){if(ws.busy){send(ws,{type:'match-busy'});return}queueMatch(ws,m.mode,m.profile?.name||ws.name,m.profile||null);return;}
    if(m.type==='cancel-match'){removeFromQueue(ws);return;}
    if(m.type==='match-state'){ws.busy=!!m.busy;if(ws.busy)removeFromQueue(ws);sendPresence();return;}
    if(m.type==='friend-request'){sendFriendRequest(ws,m);return;}
    if(m.type==='friend-response'){respondFriend(ws,m);return;}
    if(m.type==='chat-history'){
      purgeOldChatMessages();
      const conversationId=String(m.conversationId||'');
      if(!conversationId){send(ws,{type:'chat-error',error:'conversation-required'});return;}
      send(ws,{type:'chat-history',conversationId,messages:chatMessages.get(conversationId)||[]});
      return;
    }
    if(m.type==='chat-message'){
      purgeOldChatMessages();
      const conversationId=String(m.conversationId||'');
      const text=String(m.text||'').trim().slice(0,2000);
      if(!conversationId||!text){send(ws,{type:'chat-error',error:'invalid-message'});return;}
      const message={
        id:String(m.clientMessageId||`${sessionId}-${Date.now()}`),
        conversationId,
        senderId:sessionId,
        senderName:ws.name,
        text,
        createdAt:Date.now()
      };
      addChatMessage(conversationId,message);
      /* Prototype broadcast: only connected peers in the same conversation
         can receive this after the client identifies the conversation. */
      send(ws,{type:'chat-message',message});
      for(const peer of peers.values()){
        if(peer!==ws && peer.chatConversationId===conversationId) send(peer,{type:'chat-message',message});
      }
      return;
    }
    if(m.type==='chat-join'){
      ws.chatConversationId=String(m.conversationId||'');
      return;
    }
    if(m.type==='hangup'){ws.busy=false;if(m.to)route(String(m.to),{...m,from:sessionId,fromName:ws.name});sendPresence();return;}
    if(m.type==='reaction'){const to=String(m.to||''),emoji=String(m.emoji||''),now=Date.now(),last=reactionLastAt.get(sessionId)||0;if(!to||to===sessionId||!REACTIONS.has(emoji)||now-last<REACTION_COOLDOWN_MS)return;if(!peers.has(to))return;reactionLastAt.set(sessionId,now);route(to,{type:'reaction',from:sessionId,fromName:ws.name,emoji,at:now});return;}
    if(m.to)route(String(m.to),{...m,from:sessionId,fromName:ws.name,peerProfile:ws.profile});
  });
  ws.on('close',()=>{removeFromQueue(ws);if(sessionId&&peers.get(sessionId)===ws){peers.delete(sessionId);sendPresence();}});
});

const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log(`A2L server listening on ${port}`));
