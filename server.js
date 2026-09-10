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
const profiles=new Map();
const waiting=new Map([['video',[]],['voice',[]],['text',[]]]);
const serverBlocks=new Map();
const accountPlans=new Map();
const serverReports=[];
const pendingRequests=new Map();
const friendSets=new Map();
const reactionLastAt=new Map();
const MATCH_TIMEOUT_MS=60_000;
const REACTION_COOLDOWN_MS=300;
const REACTIONS=new Set(['❤️','😂','😮','👍','👏','🔥','🎉','😍']);

const SUPABASE_URL=process.env.SUPABASE_URL||'';
const SUPABASE_JWT_ISSUER=SUPABASE_URL?`${SUPABASE_URL}/auth/v1`:'';
const SUPABASE_JWKS=SUPABASE_URL?createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)):null;
const AUTH_REQUIRED=String(process.env.AUTH_REQUIRED||'false').toLowerCase()==='true';

async function verifySupabaseToken(token){
  if(!SUPABASE_JWKS||!SUPABASE_JWT_ISSUER)throw new Error('auth-not-configured');
  const {payload}=await jwtVerify(token,SUPABASE_JWKS,{issuer:SUPABASE_JWT_ISSUER});
  if(!payload.sub)throw new Error('missing-sub');
  return payload;
}
function tokenFromMessage(m){return typeof m.accessToken==='string'?m.accessToken:'';}
function send(ws,msg){if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));}
function route(to,msg){const ws=peerByPublicId(to);if(ws)send(ws,msg);}
function isLive(ws){return !!ws&&ws.readyState===1&&!!ws.routeId;}
function routeKey(ws){return String(ws.routeId||ws.authUserId||ws.sessionId||'');}
function peerByPublicId(value){const key=String(value||'');if(peers.has(key))return peers.get(key);for(const ws of peers.values()){if(String(ws.authUserId||'')===key||String(ws.sessionId||'')===key||String(ws.profile?.a2lId||'')===key)return ws;}return null;}
function friendSet(id){if(!friendSets.has(id))friendSets.set(id,new Set());return friendSets.get(id);}
function areFriends(a,b){return !!a&&!!b&&friendSet(a).has(b)&&friendSet(b).has(a);}
function isBlocked(a,b){const s=serverBlocks.get(String(a||''));return !!(s&&s.has(String(b||'')));}
function blockPair(a,b){if(!serverBlocks.has(a))serverBlocks.set(a,new Set());serverBlocks.get(a).add(b);}
function removeFromQueue(ws){for(const [mode,q] of waiting){for(let i=q.length-1;i>=0;i--){if(q[i].ws===ws){clearTimeout(q[i].timer);q.splice(i,1);}}}}
function safeProfile(p,id,name){p=p||{};const avatar=String(p.avatar||'🙂');return {userId:id,a2lId:String(p.a2lId||p.handle||id).trim().replace(/^@/,'').slice(0,30),name:String(p.name||name||'A2L user').slice(0,80),avatar:avatar.slice(0,2000),avatar_url:String(p.avatar_url||'').slice(0,2000),ageGroup:String(p.ageGroup||'').slice(0,20),languages:Array.isArray(p.languages)?p.languages.slice(0,6):[],interests:Array.isArray(p.interests)?p.interests.slice(0,10):[],bio:String(p.bio||'').slice(0,240),status:String(p.status||'Available to chat').slice(0,80)};}
function publicUser(ws){return {...(ws.profile||{}),userId:ws.routeId,authUserId:ws.authUserId||'',online:isLive(ws),inCall:!!ws.busy};}
function publicKnown(id){const ws=peers.get(id);const p=ws?.profile||profiles.get(id)||safeProfile({},id,'A2L user');return {...p,userId:id,authUserId:ws?.authUserId||p.authUserId||'',online:isLive(ws),inCall:!!ws?.busy};}
function sendPresence(){
  const users=[...profiles.keys()].map(id=>publicKnown(id));
  for(const ws of peers.values())if(isLive(ws))send(ws,{type:'presence-list',users:users.filter(u=>String(u.userId)!==String(ws.routeId)).map(u=>({...u,isFriend:areFriends(ws.routeId,u.userId)}))});
}
function sendFriendList(ws){
  const ids=friendSet(ws.routeId);const list=[];for(const id of ids){const f=peers.get(id);if(f)list.push({...publicUser(f),isFriend:true});else{const p=profiles.get(id);if(p)list.push({...p,userId:id,authUserId:p.authUserId||id,online:false,isFriend:true});}}
  send(ws,{type:'friend-list',friends:list});
}
function sendFriendState(a,b){const A=peers.get(a),B=peers.get(b);if(A)sendFriendList(A);if(B)sendFriendList(B);sendPresence();}
function queueMatch(ws,mode,name,profile){
  mode=['video','voice','text'].includes(mode)?mode:'video';removeFromQueue(ws);const q=waiting.get(mode)||[];
  for(let i=q.length-1;i>=0;i--){const c=q[i];if(!isLive(c.ws)||c.ws.routeId===ws.routeId||c.ws.busy||isBlocked(c.ws.routeId,ws.routeId)||isBlocked(ws.routeId,c.ws.routeId)){clearTimeout(c.timer);q.splice(i,1);}}
  const idx=q.findIndex(c=>c.ws.routeId!==ws.routeId&&!c.ws.busy&&!isBlocked(c.ws.routeId,ws.routeId)&&!isBlocked(ws.routeId,c.ws.routeId));
  if(idx>=0){const candidate=q.splice(idx,1)[0];clearTimeout(candidate.timer);ws.busy=true;candidate.ws.busy=true; ws.peerId=candidate.ws.routeId; candidate.ws.peerId=ws.routeId;send(candidate.ws,{type:'match-found',mode,peerId:ws.routeId,peerName:name||'A2L user',peerProfile:{...profile,authUserId:ws.authUserId},initiator:true});send(ws,{type:'match-found',mode,peerId:candidate.ws.routeId,peerName:candidate.name||'A2L user',peerProfile:{...candidate.profile,authUserId:candidate.ws.authUserId},initiator:false});sendPresence();return;}
  const entry={ws,name:name||'A2L user',profile:profile||{},queuedAt:Date.now(),timer:null};entry.timer=setTimeout(()=>{const arr=waiting.get(mode)||[];const i=arr.indexOf(entry);if(i>=0){arr.splice(i,1);send(ws,{type:'match-timeout',mode});}},MATCH_TIMEOUT_MS);q.push(entry);waiting.set(mode,q);send(ws,{type:'waiting',mode});
}
function sendFriendRequest(ws,m){
  const target=peerByPublicId(m.to||m.targetId);if(!target||target.routeId===ws.routeId||!isLive(target))return;
  const from=ws.routeId,to=target.routeId;if(areFriends(from,to)){send(ws,{type:'friend-response',requestId:m.request?.id,accepted:true,from:to,fromName:target.name,friend:publicUser(target)});return;}
  const key=`${from}:${to}`,reverse=`${to}:${from}`;if(pendingRequests.has(key)||pendingRequests.has(reverse))return;
  const req=m.request||{};const clean={id:String(req.id||`fr_${Date.now()}_${Math.random().toString(36).slice(2)}`),dbId:req.dbId||'',from,fromAuthId:ws.authUserId,to,toAuthId:target.authUserId,toA2lId:target.profile?.a2lId||'',toName:target.name,fromName:ws.name,status:'pending',at:Date.now(),profile:ws.profile};pendingRequests.set(key,clean);send(target,{type:'friend-request',request:clean});
}
function respondFriend(ws,m){
  const id=String(m.requestId||'');let key,req;for(const [k,r] of pendingRequests){if(r.id===id&&r.to===ws.routeId){key=k;req=r;break;}}if(!req)return;pendingRequests.delete(key);const from=req.from,to=ws.routeId,accepted=!!m.accepted;if(accepted){friendSet(from).add(to);friendSet(to).add(from);}const fromWs=peers.get(from);if(fromWs)send(fromWs,{type:'friend-response',requestId:req.id,accepted,from:to,fromName:ws.name,friend:publicUser(ws)});send(ws,{type:'friend-response',requestId:req.id,accepted,from,fromName:req.fromName,friend:fromWs?publicUser(fromWs):publicKnown(from)});sendFriendState(from,to);
}
function cleanupConnection(ws){removeFromQueue(ws);if(ws.peerId){const peer=peerByPublicId(ws.peerId);if(peer){peer.busy=false;peer.peerId=null;send(peer,{type:'hangup',from:ws.routeId,fromName:ws.name});}}ws.peerId=null;ws.busy=false;if(ws.routeId&&peers.get(ws.routeId)===ws){peers.delete(ws.routeId);sendPresence();}}

app.get('/api/config',(req,res)=>res.json({supabaseUrl:SUPABASE_URL,supabaseAnonKey:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'',authRequired:AUTH_REQUIRED}));
app.get('/health',(req,res)=>res.json({ok:true,service:'a2l-realtime',authRequired:AUTH_REQUIRED,clients:peers.size}));
app.get('/',(req,res)=>{const file=path.join(__dirname,'index.html');if(!fs.existsSync(file))return res.status(404).send('A2L index.html not found');res.type('html').send(fs.readFileSync(file,'utf8'));});
app.get('/css/style.css',(req,res)=>res.sendFile(path.join(__dirname,'style.css')));
app.get('/js/:file',(req,res)=>{const allowed=['plans.js','hub.js','app.js','realtime.js','calls.js','games.js','profile.js','matching.js','chat.js','realmatch.js','social.js','auth.js','identity.js','a2l-data.js','supabase-bridge.js','chat-realtime.js','safety.js'];if(!allowed.includes(req.params.file))return res.status(404).end();res.sendFile(path.join(__dirname,req.params.file));});
app.use(express.static(__dirname));

wss.on('connection',ws=>{
  ws.sessionId=null;ws.authUserId='';ws.routeId=null;ws.name='A2L user';ws.profile=safeProfile({},'','A2L user');ws.busy=false;
  ws.on('message',async raw=>{
    let m;try{m=JSON.parse(raw)}catch{return;}
    if(m.type==='register'&&m.sessionId){
      const sessionId=String(m.sessionId);let authId=String(m.authUserId||'');const token=tokenFromMessage(m);
      if(token){try{const claims=await verifySupabaseToken(token);authId=String(claims.sub||authId);}catch(e){if(AUTH_REQUIRED){send(ws,{type:'auth-error',error:'invalid-auth'});try{ws.close(1008,'invalid auth')}catch(_){}return;}}}
      if(AUTH_REQUIRED&&!authId){send(ws,{type:'auth-error',error:'authentication-required'});try{ws.close(1008,'authentication required')}catch(_){}return;}
      const routeId=authId||sessionId;ws.sessionId=sessionId;ws.authUserId=authId;ws.routeId=routeId;ws.name=String(m.name||m.profile?.name||'A2L user').slice(0,80);ws.profile=safeProfile({...m.profile,avatar_url:m.profile?.avatar_url||m.profile?.avatar},routeId,ws.name);ws.profile.authUserId=authId;profiles.set(routeId,ws.profile);
      const previous=peers.get(routeId);if(previous&&previous!==ws){removeFromQueue(previous);send(previous,{type:'replaced'});try{previous.close(4001,'replaced')}catch(_){} }
      peers.set(routeId,ws);send(ws,{type:'registered',sessionId,routeId});sendFriendList(ws);sendPresence();return;
    }
    if(!ws.routeId)return;
    const from=ws.routeId;
    if(m.type==='premium-status'){send(ws,{type:'premium-status',plan:accountPlans.get(from)||'free'});return;}
    if(m.type==='find-match'){if(ws.busy){send(ws,{type:'match-busy'});return;}queueMatch(ws,m.mode,m.profile?.name||ws.name,m.profile||{});return;}
    if(m.type==='cancel-match'){removeFromQueue(ws);return;}
    if(m.type==='match-state'){ws.busy=!!m.busy;if(ws.busy)removeFromQueue(ws);if(!ws.busy){ws.peerId=null;}sendPresence();return;}
    if(m.type==='friend-request'){sendFriendRequest(ws,m);return;}
    if(m.type==='friend-response'){respondFriend(ws,m);return;}
    if(m.type==='block-user'){const target=peerByPublicId(m.targetId||m.to);if(target){blockPair(from,target.routeId);removeFromQueue(target);removeFromQueue(ws);if(target.peerId===from){target.busy=false;send(target,{type:'blocked-by-peer'});}}send(ws,{type:'blocked',targetId:String(m.targetId||m.to||'')});sendPresence();return;}
    if(m.type==='unblock-user'){const target=String(m.targetId||'');const s=serverBlocks.get(from);if(s)s.delete(target);return;}
    if(m.type==='reaction'){const target=peerByPublicId(m.to),emoji=String(m.emoji||''),now=Date.now(),last=reactionLastAt.get(from)||0;if(!target||!isLive(target)||!REACTIONS.has(emoji)||now-last<REACTION_COOLDOWN_MS)return;reactionLastAt.set(from,now);send(target,{type:'reaction',from,fromName:ws.name,emoji,at:now});return;}
    if(m.type==='chat-message'){const target=peerByPublicId(m.to||m.targetId);const text=String(m.text||'').trim().slice(0,2000);if(!target||!isLive(target)||!text||isBlocked(from,target.routeId)||isBlocked(target.routeId,from))return;const message={id:String(m.clientMessageId||`${from}-${Date.now()}-${Math.random().toString(36).slice(2)}`),conversationId:String(m.conversationId||''),from,fromName:ws.name,peerProfile:ws.profile,text,at:Date.now(),createdAt:Date.now()};send(target,{type:'chat-message',message,from,fromName:ws.name,peerProfile:ws.profile,text,at:message.at});send(ws,{type:'chat-delivered',clientMessageId:message.id,to:target.routeId});return;}
    if(m.type==='hangup'){const target=peerByPublicId(m.to);ws.busy=false;const peer=target;if(peer){peer.busy=false;peer.peerId=null;send(peer,{type:'hangup',from,fromName:ws.name});}ws.peerId=null;removeFromQueue(ws);sendPresence();return;}
    if(m.type==='call-invite'){const target=peerByPublicId(m.to);if(!target||!isLive(target)||target.busy||isBlocked(from,target.routeId)||!areFriends(from,target.routeId))return;send(target,{type:'call-invite',from,fromName:ws.name,profile:ws.profile,kind:'video',source:'friend-call'});return;}
    if(m.type==='call-accept'||m.type==='call-declined'||m.type==='call-busy'){const target=peerByPublicId(m.to);if(target)send(target,{...m,from,fromName:ws.name,profile:ws.profile});return;}
    if(m.type==='offer'||m.type==='answer'||m.type==='ice'){const target=peerByPublicId(m.to);if(target)send(target,{...m,from,fromName:ws.name,peerProfile:ws.profile});return;}
    if(m.type==='report-user'){const target=String(m.targetId||m.to||'');serverReports.push({reporterId:from,targetId:target,category:String(m.category||'other').slice(0,60),details:String(m.details||'').slice(0,1000),createdAt:Date.now()});send(ws,{type:'report-received',targetId:target});return;}
    if(m.type==='specific-person-search'||m.type==='direct-connection'){if(accountPlans.get(from)!=='premium'){send(ws,{type:'premium-required',feature:m.type});return;}const target=peerByPublicId(m.targetId||m.to);if(!target||target===ws||!isLive(target)||isBlocked(from,target.routeId)){send(ws,{type:'direct-connection-error',error:'user-offline'});return;}send(target,{type:'direct-connection-request',from,fromName:ws.name,mode:'video',profile:ws.profile});send(ws,{type:'direct-connection-sent',targetId:target.routeId});return;}
  });
  ws.on('close',()=>cleanupConnection(ws));
  ws.on('error',()=>{});
});

const port=process.env.PORT||3000;server.listen(port,'0.0.0.0',()=>console.log(`A2L server listening on ${port}`));
