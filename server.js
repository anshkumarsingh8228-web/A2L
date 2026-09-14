const http=require('http');const fs=require('fs');const path=require('path');const crypto=require('crypto');const dns=require('dns');const {WebSocketServer}=require('ws');const {Pool}=require('pg');
if(dns.setDefaultResultOrder)dns.setDefaultResultOrder('ipv4first');
const PORT=Number(process.env.PORT||10000),ROOT=__dirname;
const DATABASE_URL=process.env.DATABASE_URL||'';const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');const SUPABASE_ANON_KEY=process.env.SUPABASE_ANON_KEY||'';const TURN_URL=process.env.TURN_URL||'';const TURN_USERNAME=process.env.TURN_USERNAME||'';const TURN_CREDENTIAL=process.env.TURN_CREDENTIAL||'';const REQUIRE_AUTH=process.env.REQUIRE_AUTH!=='false';
function resolveDatabaseUrl(rawUrl){
  if(!rawUrl)return '';
  try{
    const refMatch=(SUPABASE_URL||'').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    const defaultRef=refMatch?refMatch[1]:'kxvlhajuxbnwkejchhrt';
    const region=process.env.SUPABASE_REGION||'ap-northeast-1';
    const poolPort=process.env.SUPABASE_POOLER_PORT||'5432';

    // Direct Supabase hostname
    const directMatch=rawUrl.match(/@db\.([a-z0-9]+)\.supabase\.co(:[0-9]+)?(\/.*)?$/i);
    if(directMatch){
      const ref=directMatch[1], rest=directMatch[3]||'/postgres';
      let prefix=rawUrl.slice(0,directMatch.index);
      const sIdx=prefix.indexOf('://');
      if(sIdx!==-1){
        const creds=prefix.slice(sIdx+3), cIdx=creds.indexOf(':'), user=cIdx!==-1?creds.slice(0,cIdx):creds;
        if(!user.includes('.')){
          prefix=prefix.slice(0,sIdx+3)+user+'.'+ref+(cIdx!==-1?creds.slice(cIdx):'');
        }
      }
      return `${prefix}@aws-0-${region}.pooler.supabase.com:${poolPort}${rest}`;
    }

    // Pooler Supabase hostname
    const poolerMatch=rawUrl.match(/@([^@:]*pooler\.supabase\.com)(:[0-9]+)?(\/.*)?$/i);
    if(poolerMatch){
      let prefix=rawUrl.slice(0,poolerMatch.index);
      const sIdx=prefix.indexOf('://');
      if(sIdx!==-1){
        const creds=prefix.slice(sIdx+3), cIdx=creds.indexOf(':'), user=cIdx!==-1?creds.slice(0,cIdx):creds;
        if(!user.includes('.')){
          prefix=prefix.slice(0,sIdx+3)+user+'.'+defaultRef+(cIdx!==-1?creds.slice(cIdx):'');
        }
      }
      const host=poolerMatch[1], rest=poolerMatch[3]||'/postgres';
      return `${prefix}@${host}:${poolPort}${rest}`;
    }
  }catch(e){console.warn('resolveDatabaseUrl error:',e.message);}
  return rawUrl;
}
const RESOLVED_DATABASE_URL=resolveDatabaseUrl(DATABASE_URL);
const pool=RESOLVED_DATABASE_URL?new Pool({connectionString:RESOLVED_DATABASE_URL,ssl:RESOLVED_DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},max:Number(process.env.DB_POOL_MAX||10)}):null;
const clients=new Map(),queue=[];
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
const send=(ws,m)=>{if(ws?.readyState===1)ws.send(JSON.stringify(m))};
const cleanId=v=>String(v||'').trim().toLowerCase().replace(/^@/,'').replace(/[^a-z0-9_\-]/g,'').slice(0,40);
const q=async(text,params=[])=>{if(!pool)throw new Error('DATABASE_URL is not configured');return pool.query(text,params)};
async function sb(path,method='GET',body=null,token=''){
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY)return null;
  const headers={'apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${token||SUPABASE_ANON_KEY}`};
  if(body){headers['Content-Type']='application/json';headers['Prefer']='return=representation';}
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body?JSON.stringify(body):undefined});
    if(!r.ok)return null;
    return await r.json();
  }catch(e){return null;}
}
const profileOf=c=>c?.profile||{};
const authCache=new Map();
function bearer(headers){const h=headers?.authorization||'';return /^Bearer\s+/i.test(h)?h.replace(/^Bearer\s+/i,'').trim():''}
async function verifyToken(token){
  if(!REQUIRE_AUTH)return {id:null,email:null,metadata:{}};
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY)throw Object.assign(new Error('Supabase Auth is not configured on the server'),{status:503});
  if(!token)throw Object.assign(new Error('Authentication required'),{status:401});
  const cached=authCache.get(token);if(cached&&cached.expires>Date.now())return cached.user;
  const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`} });
  if(!r.ok)throw Object.assign(new Error('Invalid or expired authentication session'),{status:401});
  const user=await r.json();if(!user?.id)throw Object.assign(new Error('Invalid authentication session'),{status:401});
  authCache.set(token,{user,expires:Date.now()+30000});return user;
}
async function authContextFromUser(user,requestedId='',token=''){
  if(!user?.id)return null;
  const desired=cleanId(requestedId||user.user_metadata?.a2l_id||user.user_metadata?.username||'');
  const id=desired||`a2l_${user.id.slice(0,8)}`;
  try{
    const existing=await q('select * from profiles where id=$1',[user.id]);
    if(existing.rows[0])return {user,a2lId:existing.rows[0].a2l_id||existing.rows[0].username||id,profile:existing.rows[0],token};
    const collision=await q('select 1 from profiles where a2l_id=$1',[id]);
    if(!collision.rows[0]){
      await q('insert into profiles(id,a2l_id,username,display_name) values($1,$2,$2,$3)',[user.id,id,user.user_metadata?.display_name||user.email?.split('@')[0]||'A2L user']);
    }
    return {user,a2lId:id,profile:null,token};
  }catch(e){
    const disp=user.user_metadata?.display_name||user.email?.split('@')[0]||'A2L user';
    await sb(`profiles?id=eq.${user.id}`,'PATCH',{a2l_id:id,username:id,display_name:disp},token);
    const rest=await sb(`profiles?id=eq.${user.id}&select=*`,'GET',null,token);
    if(Array.isArray(rest)&&rest[0])return {user,a2lId:rest[0].a2l_id||id,profile:rest[0],token};
    return {user,a2lId:id,profile:{id:user.id,a2l_id:id,display_name:disp},token};
  }
}
async function authenticateHttp(req,requestedId=''){const token=bearer(req.headers);const user=await verifyToken(token);return authContextFromUser(user,requestedId,token)}
async function authenticateWs(token,requestedId=''){const user=await verifyToken(token);return authContextFromUser(user,requestedId,token)}
async function ensureProfile(c,p={}){
  if(!c?.authUserId)return;
  const a2l=cleanId(c.id);
  try{
    await q(`update profiles set username=coalesce($2,username),display_name=$3,avatar_url=$4,photo_data=coalesce($5,photo_data),bio=$6,location=$7,age_group=$8,languages=$9,interests=$10,looking_for=$11,visibility=$12,privacy=$13,match_prefs=$14,updated_at=now(),a2l_id=coalesce(a2l_id,$2) where id=$1`,
      [c.authUserId,a2l,p.displayName||'A2L user',p.avatar||null,p.photoData||null,p.bio||'',p.location||p.city||'',p.ageGroup||'',p.languages||[],p.interests||[],p.lookingFor||[],p.visibility||'public',JSON.stringify(p.privacy||{}),JSON.stringify(p.matchPrefs||{})]);
  }catch(e){
    await sb(`profiles?id=eq.${c.authUserId}`,'PATCH',{a2l_id:a2l,username:a2l,display_name:p.displayName||'A2L user',avatar_url:p.avatar||null,photo_data:p.photoData||null,bio:p.bio||'',location:p.location||'',age_group:p.ageGroup||'',languages:p.languages||[],interests:p.interests||[],looking_for:p.lookingFor||[],visibility:p.visibility||'public',privacy:p.privacy||{},match_prefs:p.matchPrefs||{}},c.token);
  }
}
function publicPeerRow(r){return {a2lId:r.a2l_id||r.username||`a2l_${String(r.id).slice(0,8)}`,displayName:r.display_name||'A2L user',avatar:r.avatar_url||'🙂',photoData:r.photo_data||'',ageGroup:r.age_group||'',languages:r.languages||[],interests:r.interests||[],location:r.location||''};}
async function profileByA2L(param,token=''){
  const val=String(param||'').trim();
  if(!val)return {rows:[]};
  const isUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  const clean=cleanId(val);
  try{
    if(pool){
      const r=isUuid
        ? await q('select * from profiles where id=$1 or a2l_id=$2 limit 1',[val,clean])
        : await q('select * from profiles where a2l_id=$1 or id::text=$1 limit 1',[clean]);
      if(r.rows&&r.rows.length)return r;
    }
  }catch(e){}
  const rest=isUuid
    ? await sb(`profiles?or=(id.eq.${val},a2l_id.eq.${clean})&select=*`,'GET',null,token)
    : await sb(`profiles?a2l_id=eq.${clean}&select=*`,'GET',null,token);
  return {rows:Array.isArray(rest)?rest:[]};
}
async function isBlocked(a,b){if(!pool||!a||!b)return false;try{const r=await q(`select 1 from blocks bl join profiles pa on pa.id=bl.blocker_id join profiles pb on pb.id=bl.blocked_id where (pa.a2l_id=$1 and pb.a2l_id=$2) or (pa.a2l_id=$2 and pb.a2l_id=$1) limit 1`,[cleanId(a),cleanId(b)]);return !!r.rows[0]}catch{return false}}
async function areConnected(a,b){if(!pool||!a?.authUserId||!b?.authUserId)return false;try{const r=await q('select 1 from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1) limit 1',[a.authUserId,b.authUserId]);return !!r.rows[0]}catch{return false}}
function privacyValue(c,key,fallback){return profileOf(c)?.privacy?.[key]||fallback}
async function canCall(c,p){if(!c||!p||c.id===p.id)return {ok:false,reason:'busy'};if(await isBlocked(c.id,p.id))return {ok:false,reason:'blocked'};if(p.busy)return {ok:false,reason:'busy'};const setting=privacyValue(p,'call','everyone');if(setting==='nobody')return {ok:false,reason:'privacy'};if(setting==='connected'&&!(await areConnected(c,p)))return {ok:false,reason:'privacy'};return {ok:true}}
async function compatible(a,b){if(!a||!b||a.id===b.id||a.busy||b.busy)return false;const aa=a.prefs||{},bb=b.prefs||{},pa=profileOf(a),pb=profileOf(b);if(aa.online===false||bb.online===false)return false;if(pa?.privacy?.search===false||pb?.privacy?.search===false)return false;if(await isBlocked(a.id,b.id))return false;if(aa.mode&&aa.mode!=='any'&&bb.mode&&bb.mode!=='any'&&aa.mode!==bb.mode)return false;if(aa.age==='same'&&pa.ageGroup&&pb.ageGroup&&pa.ageGroup!==pb.ageGroup)return false;if(bb.age==='same'&&pa.ageGroup&&pb.ageGroup&&pa.ageGroup!==pb.ageGroup)return false;if(aa.interest&&aa.interest!=='any'&&!(pb.interests||[]).includes(aa.interest))return false;if(bb.interest&&bb.interest!=='any'&&!(pa.interests||[]).includes(bb.interest))return false;return true;}
function removeQueue(id){for(let i=queue.length-1;i>=0;i--)if(queue[i]===id)queue.splice(i,1)}
async function saveHistory(a,b,type='random'){if(!a?.authUserId||!b?.authUserId)return null;try{const r=await q(`insert into connection_history(user_a,user_b,session_type) values($1,$2,$3) returning id`,[a.authUserId,b.authUserId,type]);return r.rows[0]?.id}catch(e){console.error('history',e.message);return null}}
async function notify(userA2L,type,actorA2L,payload={}){try{const [u,a]=await Promise.all([profileByA2L(userA2L),actorA2L?profileByA2L(actorA2L):Promise.resolve({rows:[]})]);const uid=u.rows[0]?.id,aid=a.rows[0]?.id||null;if(!uid)return;try{await q(`insert into notifications(user_id,type,actor_id,payload) values($1,$2,$3,$4)`,[uid,type,aid,JSON.stringify(payload)]);}catch{await sb('notifications','POST',{user_id:uid,type,actor_id:aid,payload});}const c=clients.get(cleanId(userA2L));if(c)send(c.ws,{type:'notification',notification:{type,actorId:actorA2L,payload,createdAt:new Date().toISOString()}})}catch(e){console.error('notify',e.message)}}
let pairingLock=Promise.resolve();
async function pair(c){const run=pairingLock.then(async()=>{if(!c||c.busy)return;removeQueue(c.id);for(let i=0;i<queue.length;i++){const other=clients.get(queue[i]);if(!other||other.ws.readyState!==1||other.busy){queue.splice(i,1);i--;continue}if(!await compatible(c,other))continue;queue.splice(i,1);c.busy=other.busy=true;c.peerId=other.id;c.historyId=await saveHistory(c,other,c.prefs?.mode==='voice'||other.prefs?.mode==='voice'?'voice':'random');other.peerId=c.id;other.historyId=c.historyId;const mode=(c.prefs?.mode&&c.prefs.mode!=='any')?c.prefs.mode:(other.prefs?.mode&&other.prefs.mode!=='any')?other.prefs.mode:'video';send(c.ws,{type:'match-found',peer:other.public,mode,initiator:true,historyId:c.historyId});send(other.ws,{type:'match-found',peer:c.public,mode,initiator:false,historyId:c.historyId});return}if(!c.busy){queue.push(c.id);send(c.ws,{type:'waiting'})}});pairingLock=run.catch(()=>{});return run}
function peer(c){return c?.peerId?clients.get(c.peerId):null}function relay(c,m){const p=peer(c);if(p)send(p.ws,m)}
async function endPair(c,notifyPeer=true,outcome='ended'){removeQueue(c?.id);const p=peer(c);if(c?.historyId){q(`update connection_history set ended_at=now(),outcome=$1,last_seen_at=now() where id=$2`,[outcome,c.historyId]).catch(()=>{})}c.busy=false;c.peerId=null;c.historyId=null;if(p){p.busy=false;p.peerId=null;p.historyId=null;if(notifyPeer)send(p.ws,{type:'hangup',reason:'peer-ended'})}}
async function api(req,res,body){
 const url=new URL(req.url,`http://${req.headers.host}`),parts=url.pathname.split('/').filter(Boolean);
   if(req.method==='GET'&&url.pathname==='/api/health'){let dbOk=false,dbErr=null;try{if(pool){await pool.query('select 1');dbOk=true;}}catch(e){dbErr=e.message;}return json(res,200,{ok:true,database:dbOk,dbError:dbErr||undefined,auth:REQUIRE_AUTH&&!!SUPABASE_URL});}
 if(req.method==='GET'&&url.pathname==='/api/config')return json(res,200,{supabaseUrl:SUPABASE_URL,supabaseAnonKey:SUPABASE_ANON_KEY,authRequired:REQUIRE_AUTH});
 if(req.method==='GET'&&url.pathname==='/api/rtc-config'){try{await authenticateHttp(req);return json(res,200,{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun.cloudflare.com:3478'},...(TURN_URL?[{urls:TURN_URL,username:TURN_USERNAME,credential:TURN_CREDENTIAL}]:[])]});}catch(e){return json(res,e.status||401,{error:e.message})}}
  if(!pool&&!SUPABASE_URL)return json(res,503,{error:'Database service not configured'});if(parts[0]!=='api')return false;
  let ctx;try{ctx=await authenticateHttp(req,req.headers['x-a2l-id']||body?.profile?.a2lId||url.searchParams.get('user'));}catch(e){return json(res,e.status||401,{error:e.message})}
  const id=ctx.a2lId, uid=ctx.user.id;
  try{
   if(req.method==='PUT'&&parts[1]==='profile'){const p={...(body.profile||body)};delete p.a2lId;await ensureProfile({id,authUserId:uid,token:ctx.token},p);return json(res,200,{ok:true,a2lId:id});}
   if(req.method==='GET'&&parts[1]==='me'){
     try{const r=await q('select * from profiles where id=$1',[uid]);if(r.rows[0])return json(res,200,publicPeerRow(r.rows[0]));}catch{}
     const rest=await sb(`profiles?id=eq.${uid}&select=*`,'GET',null,ctx.token);
     return json(res,200,Array.isArray(rest)&&rest[0]?publicPeerRow(rest[0]):null);
   }
   if(req.method==='GET'&&parts[1]==='profile'&&parts[2]){
     const r=await profileByA2L(parts[2],ctx.token);
     return json(res,200,r.rows[0]?publicPeerRow(r.rows[0]):null);
   }
   if(req.method==='GET'&&parts[1]==='notifications'){
     try{const r=await q('select * from notifications where user_id=$1 order by created_at desc limit 100',[uid]);return json(res,200,r.rows);}catch{}
     const rest=await sb(`notifications?user_id=eq.${uid}&order=created_at.desc&limit=100`,'GET',null,ctx.token);
     return json(res,200,Array.isArray(rest)?rest:[]);
   }
   if(req.method==='GET'&&parts[1]==='requests'){
     let fRows=[], cRows=[], rRows=[];
     try{
       const [f,c,r]=await Promise.all([
         q("select fr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,ps.avatar_url as from_avatar,ps.photo_data as from_photo_data,pr.a2l_id as to_a2l_id from friend_requests fr join profiles ps on ps.id=fr.sender_id join profiles pr on pr.id=fr.receiver_id where (fr.receiver_id=$1 or fr.sender_id=$1) and fr.status='pending' order by fr.created_at desc limit 100",[uid]),
         q("select cr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,ps.avatar_url as from_avatar,ps.photo_data as from_photo_data,pr.a2l_id as to_a2l_id from chat_requests cr join profiles ps on ps.id=cr.sender_id join profiles pr on pr.id=cr.receiver_id where (cr.receiver_id=$1 or cr.sender_id=$1) and cr.status='pending' order by cr.created_at desc limit 100",[uid]),
         q("select rr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,ps.avatar_url as from_avatar,ps.photo_data as from_photo_data,pr.a2l_id as to_a2l_id from reconnect_requests rr join profiles ps on ps.id=rr.from_user join profiles pr on pr.id=rr.to_user where (rr.to_user=$1 or rr.from_user=$1) and rr.status='pending' order by rr.created_at desc limit 100",[uid])
       ]);
       fRows=f.rows; cRows=c.rows; rRows=r.rows;
     }catch(e){
       const restReqs=await sb(`friend_requests?or=(receiver_id.eq.${uid},sender_id.eq.${uid})&status=eq.pending&select=*,sender:profiles!sender_id(*)&order=created_at.desc`,'GET',null,ctx.token);
       if(Array.isArray(restReqs)){
         fRows=restReqs.map(fr=>({
           ...fr,
           from_a2l_id:fr.sender?.a2l_id||'a2l_user',
           from_name:fr.sender?.display_name||'A2L user',
           from_avatar:fr.sender?.avatar_url||'🙂',
           from_photo_data:fr.sender?.photo_data||''
         }));
       }
     }
     const norm=(rows)=>rows.map(x=>({...x,from:x.from_a2l_id,to:x.to_a2l_id,from_user:x.from_a2l_id,to_user:x.to_a2l_id,fromName:x.from_name,avatar:x.from_avatar||'🙂',photoData:x.from_photo_data||''}));
     return json(res,200,{friends:norm(fRows),chats:norm(cRows),reconnects:norm(rRows)});
   }
   if(req.method==='POST'&&parts[1]==='report'){
     const to=cleanId(body.to),t=await profileByA2L(to,ctx.token);if(!t.rows[0]||to===id)return json(res,400,{error:'Invalid reported user'});const reason=String(body.reason||'Other').trim().slice(0,500)||'Other',context=String(body.context||'general').slice(0,40);const targetId=t.rows[0].id;
     try{const r=await q(`insert into reports(reporter_id,reported_id,category,details) values($1,$2,$3,$4) returning id,created_at`,[uid,targetId,reason,context]);return json(res,201,{ok:true,id:r.rows[0].id,createdAt:r.rows[0].created_at});}catch{}
     const rest=await sb('reports','POST',{reporter_id:uid,reported_id:targetId,category:reason,details:context},ctx.token);
     return json(res,201,{ok:true,id:rest?.[0]?.id||crypto.randomUUID(),createdAt:new Date().toISOString()});
   }
   if(req.method==='POST'&&parts[1]==='block'){
     const to=cleanId(body.to),t=await profileByA2L(to,ctx.token);if(!t.rows[0]||to===id)return json(res,400,{error:'Invalid user'});
     try{await q('insert into blocks(blocker_id,blocked_id) values($1,$2) on conflict(blocker_id,blocked_id) do nothing',[uid,t.rows[0].id])}catch{}
     try{await q('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)',[uid,t.rows[0].id])}catch{}
     try{await sb('blocks','POST',{blocker_id:uid,blocked_id:t.rows[0].id},ctx.token);}catch{}
     try{await sb(`friendships?or=(and(user_a.eq.${uid},user_b.eq.${t.rows[0].id}),and(user_a.eq.${t.rows[0].id},user_b.eq.${uid}))`,'DELETE',null,ctx.token);}catch{}
     const target=clients.get(to);if(target){send(target.ws,{type:'blocked',by:id});await endPair(target,true,'blocked')}return json(res,201,{ok:true});
   }
   if(req.method==='POST'&&parts[1]==='friend-request'){
     const targetA2L=cleanId(body.to),t=await profileByA2L(targetA2L,ctx.token),to=t.rows[0]?.id;
     if(!to||to===uid)return json(res,400,{error:to===uid?'Cannot add yourself':'Invalid user'});
     if(await isBlocked(id,targetA2L))return json(res,403,{error:'User is blocked'});
     if(t.rows[0].privacy?.requests===false)return json(res,403,{error:'Connection requests are disabled'});
     let r=null;
     try{
       const ins=await q(`insert into friend_requests(sender_id,receiver_id,status) values($1,$2,'pending') on conflict(sender_id,receiver_id) do update set status='pending',updated_at=now() returning *`,[uid,to]);
       r=ins.rows[0];
     }catch(e){
       const rest=await sb('friend_requests','POST',{sender_id:uid,receiver_id:to,status:'pending'},ctx.token);
       if(Array.isArray(rest)&&rest[0])r=rest[0];
       else r={id:crypto.randomUUID(),sender_id:uid,receiver_id:to,status:'pending'};
     }
     const myProf=(await profileByA2L(id,ctx.token)).rows[0];
     await notify(targetA2L,'friend_request',id,{requestId:r.id,request:r,sender:publicPeerRow(myProf)});
     const tc=clients.get(targetA2L);
     if(tc)send(tc.ws,{type:'friend-request-received',request:{...r,from:id,fromName:myProf?.display_name||'A2L user',avatar:myProf?.avatar_url||'🙂',photoData:myProf?.photo_data||''}});
     return json(res,201,r);
   }
   if(req.method==='POST'&&parts[1]==='friend-response'){
     let x=null;
     try{
       const r=await q('select * from friend_requests where id=$1 and receiver_id=$2',[body.requestId,uid]);
       x=r.rows[0];
     }catch{
       const rest=await sb(`friend_requests?id=eq.${body.requestId}&receiver_id=eq.${uid}`,'GET',null,ctx.token);
       if(Array.isArray(rest)&&rest[0])x=rest[0];
     }
     if(!x)return json(res,404,{error:'Request not found'});
     const status=body.accepted?'accepted':'declined';
     try{await q('update friend_requests set status=$1,updated_at=now() where id=$2',[status,body.requestId]);}catch{
       await sb(`friend_requests?id=eq.${body.requestId}`,'PATCH',{status},ctx.token);
     }
     const from=await profileByA2L(x.sender_id,ctx.token);
     const fromA2L=from.rows[0]?.a2l_id;
     const myProf=(await profileByA2L(id,ctx.token)).rows[0];
     if(body.accepted){
       const [a,b]=[x.sender_id,x.receiver_id].sort();
       try{await q(`insert into friendships(user_a,user_b) values($1,$2) on conflict do nothing`,[a,b]);}catch{
         await sb('friendships','POST',{user_a:a,user_b:b},ctx.token);
       }
       let cid=null;
       try{
         let cr=await q(`select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,[uid,x.sender_id]);
         if(!cr.rows[0]){
           const created=await q(`insert into conversations(kind) values('direct') returning id`,[]);
           cid=created.rows[0].id;
           await q(`insert into conversation_members(conversation_id,user_id) values($1,$2),($1,$3)`,[cid,uid,x.sender_id]);
         }else cid=cr.rows[0].id;
       }catch{
         const created=await sb('conversations','POST',{kind:'direct'},ctx.token);
         if(Array.isArray(created)&&created[0]){
           cid=created[0].id;
           await sb('conversation_members','POST',[{conversation_id:cid,user_id:uid},{conversation_id:cid,user_id:x.sender_id}],ctx.token);
         }
       }
       if(fromA2L){
         await notify(fromA2L,'friend_accepted',id,{requestId:body.requestId,friend:publicPeerRow(myProf)});
         const tc=clients.get(fromA2L);
         if(tc)send(tc.ws,{type:'friend-accepted',friend:publicPeerRow(myProf)});
       }
       return json(res,200,{ok:true,friend:from.rows[0]?publicPeerRow(from.rows[0]):null});
     }
     if(fromA2L)await notify(fromA2L,'friend_declined',id,{requestId:body.requestId});
     return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&parts[1]==='friends'){
     let rows=[];
     try{
       const r=await q(`select p.*,
         (select m.body from messages m join conversation_members cm1 on cm1.conversation_id=m.conversation_id and cm1.user_id=$1 join conversation_members cm2 on cm2.conversation_id=m.conversation_id and cm2.user_id=p.id order by m.created_at desc limit 1) as last_message,
         (select m.created_at from messages m join conversation_members cm1 on cm1.conversation_id=m.conversation_id and cm1.user_id=$1 join conversation_members cm2 on cm2.conversation_id=m.conversation_id and cm2.user_id=p.id order by m.created_at desc limit 1) as last_message_at,
         (select count(*)::int from messages m join conversation_members cm1 on cm1.conversation_id=m.conversation_id and cm1.user_id=$1 join conversation_members cm2 on cm2.conversation_id=m.conversation_id and cm2.user_id=p.id where m.sender_id=p.id and m.read_at is null) as unread_count,
         (select cm1.conversation_id from conversation_members cm1 join conversation_members cm2 on cm2.conversation_id=cm1.conversation_id and cm2.user_id=p.id where cm1.user_id=$1 limit 1) as conversation_id
         from profiles p join friendships f on ((f.user_a=$1 and f.user_b=p.id) or (f.user_b=$1 and f.user_a=p.id))`,[uid]);
       rows=r.rows;
     }catch(e){
       const fships=await sb(`friendships?or=(user_a.eq.${uid},user_b.eq.${uid})`,'GET',null,ctx.token);
       if(Array.isArray(fships)&&fships.length){
         const friendIds=fships.map(f=>f.user_a===uid?f.user_b:f.user_a);
         if(friendIds.length){
           const profs=await sb(`profiles?id=in.(${friendIds.join(',')})`,'GET',null,ctx.token);
           if(Array.isArray(profs))rows=profs;
         }
       }
     }
     const result=rows.map(r=>{
       const pub=publicPeerRow(r);
       const targetA2L=cleanId(pub.a2lId);
       const isOnline=clients.has(targetA2L)&&clients.get(targetA2L).ws.readyState===1;
       return {
         ...pub,
         online:isOnline,
         lastMessage:r.last_message||null,
         lastMessageAt:r.last_message_at||null,
         unreadCount:Number(r.unread_count||0),
         conversationId:r.conversation_id||null
       };
     });
     return json(res,200,result);
   }
   if(req.method==='GET'&&parts[1]==='users'&&parts[2]==='search'){
     const term=String(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,50);
     if(!term||term.length<1)return json(res,200,[]);
     let rows=[];
     try{
       const r=await q(`select p.* from profiles p where (p.a2l_id ilike $1 or p.display_name ilike $1) and p.id<>$2 and p.visibility<>'private' order by p.updated_at desc limit 25`,[`%${term}%`,uid]);
       rows=r.rows;
     }catch(e){
       const rest=await sb(`profiles?or=(a2l_id.ilike.*${encodeURIComponent(term)}*,display_name.ilike.*${encodeURIComponent(term)}*)&visibility=neq.private&id=neq.${uid}&order=updated_at.desc&limit=25`,'GET',null,ctx.token);
       if(Array.isArray(rest))rows=rest;
     }
     const results=await Promise.all(rows.map(async p=>{
       const pub=publicPeerRow(p);
       if(await isBlocked(id,pub.a2lId))return null;
       let status='none';
       try{
         const isFriend=await q('select 1 from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1) limit 1',[uid,p.id]);
         if(isFriend.rows[0])status='friend';
         else{
           const outReq=await q("select 1 from friend_requests where sender_id=$1 and receiver_id=$2 and status='pending' limit 1",[uid,p.id]);
           if(outReq.rows[0])status='pending_outgoing';
           else{
             const inReq=await q("select 1 from friend_requests where sender_id=$1 and receiver_id=$2 and status='pending' limit 1",[p.id,uid]);
             if(inReq.rows[0])status='pending_incoming';
           }
         }
       }catch(e){
         const fr=await sb(`friend_requests?or=(and(sender_id.eq.${uid},receiver_id.eq.${p.id}),and(sender_id.eq.${p.id},receiver_id.eq.${uid}))&status=eq.pending`,'GET',null,ctx.token);
         if(Array.isArray(fr)&&fr[0])status=fr[0].sender_id===uid?'pending_outgoing':'pending_incoming';
         else{
           const fship=await sb(`friendships?or=(and(user_a.eq.${uid},user_b.eq.${p.id}),and(user_a.eq.${p.id},user_b.eq.${uid}))`,'GET',null,ctx.token);
           if(Array.isArray(fship)&&fship[0])status='friend';
         }
       }
       return {...pub,status,online:clients.has(cleanId(pub.a2lId))};
     }));
     return json(res,200,results.filter(Boolean));
   }
   if(req.method==='POST'&&parts[1]==='chat-request'){
     const targetA2L=cleanId(body.to),t=await profileByA2L(targetA2L,ctx.token),to=t.rows[0]?.id;if(!to||to===uid)return json(res,400,{error:'Invalid users'});if(await isBlocked(id,targetA2L))return json(res,403,{error:'User is blocked'});
     let r=null;
     try{const ins=await q(`insert into chat_requests(sender_id,receiver_id,status) values($1,$2,'pending') on conflict(sender_id,receiver_id) do update set status='pending',updated_at=now() returning *`,[uid,to]);r=ins.rows[0];}catch{
       const rest=await sb('chat_requests','POST',{sender_id:uid,receiver_id:to,status:'pending'},ctx.token);r=Array.isArray(rest)?rest[0]:{id:crypto.randomUUID()};
     }
     await notify(targetA2L,'chat_request',id,{requestId:r.id,request:r});return json(res,201,r);
   }
   if(req.method==='POST'&&parts[1]==='chat-response'){
     let x=null;
     try{const r=await q('select * from chat_requests where id=$1 and receiver_id=$2',[body.requestId,uid]);x=r.rows[0];}catch{
       const rest=await sb(`chat_requests?id=eq.${body.requestId}&receiver_id=eq.${uid}`,'GET',null,ctx.token);if(Array.isArray(rest))x=rest[0];
     }
     if(!x)return json(res,404,{error:'Request not found'});
     try{await q('update chat_requests set status=$1,updated_at=now() where id=$2',[body.accepted?'accepted':'declined',body.requestId]);}catch{
       await sb(`chat_requests?id=eq.${body.requestId}`,'PATCH',{status:body.accepted?'accepted':'declined'},ctx.token);
     }
     const from=await profileByA2L(x.sender_id,ctx.token);await notify(from.rows[0]?.a2l_id,body.accepted?'chat_accepted':'chat_declined',id,{requestId:body.requestId});return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&parts[1]==='history'){
     try{const r=await q(`select h.*,case when h.user_a=$1 then h.user_b else h.user_a end as other_id,p.a2l_id as other_a2l_id,p.display_name,p.avatar_url,p.photo_data from connection_history h join profiles p on p.id=case when h.user_a=$1 then h.user_b else h.user_a end where h.user_a=$1 or h.user_b=$1 order by h.last_seen_at desc limit 100`,[uid]);return json(res,200,r.rows);}catch{}
     const rest=await sb(`connection_history?or=(user_a.eq.${uid},user_b.eq.${uid})&order=last_seen_at.desc&limit=100`,'GET',null,ctx.token);
     return json(res,200,Array.isArray(rest)?rest:[]);
   }
   if(req.method==='POST'&&parts[1]==='reconnect'){
     const t=await profileByA2L(body.to,ctx.token),to=t.rows[0]?.id;if(!to||to===uid)return json(res,400,{error:'Invalid user'});
     let r=null;
     try{const ins=await q(`insert into reconnect_requests(from_user,to_user,history_id) values($1,$2,$3) returning *`,[uid,to,body.historyId]);r=ins.rows[0];}catch{
       const rest=await sb('reconnect_requests','POST',{from_user:uid,to_user:to,history_id:body.historyId},ctx.token);r=Array.isArray(rest)?rest[0]:{id:crypto.randomUUID()};
     }
     await notify(body.to,'reconnect_request',id,{requestId:r.id,historyId:body.historyId});return json(res,201,r);
   }
   if(req.method==='POST'&&parts[1]==='reconnect-response'){
     let x=null;
     try{const r=await q('select * from reconnect_requests where id=$1 and to_user=$2',[body.requestId,uid]);x=r.rows[0];}catch{
       const rest=await sb(`reconnect_requests?id=eq.${body.requestId}&to_user=eq.${uid}`,'GET',null,ctx.token);if(Array.isArray(rest))x=rest[0];
     }
     if(!x)return json(res,404,{error:'Request not found'});
     try{await q('update reconnect_requests set status=$1,responded_at=now() where id=$2',[body.accepted?'accepted':'declined',body.requestId]);}catch{
       await sb(`reconnect_requests?id=eq.${body.requestId}`,'PATCH',{status:body.accepted?'accepted':'declined'},ctx.token);
     }
     const from=await profileByA2L(x.from_user,ctx.token);await notify(from.rows[0]?.a2l_id,body.accepted?'reconnect_accepted':'reconnect_declined',id,{requestId:body.requestId});return json(res,200,{ok:true});
   }
   if(req.method==='POST'&&parts[1]==='message'){
     const targetA2L=cleanId(body.to),t=await profileByA2L(targetA2L,ctx.token),to=t.rows[0]?.id,text=String(body.text||'').trim().slice(0,2000);
     if(!text||!to)return json(res,400,{error:'Invalid message'});
     const targetProfile=t.rows[0];
     if(!targetProfile)return json(res,404,{error:'User not found'});
     if(await isBlocked(id,targetA2L))return json(res,403,{error:'User is blocked'});
     let cid=null;
     try{
       let cr=await q(`select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,[uid,to]);
       cid=cr.rows[0]?.id;
       if(!cid){
         const created=await q(`insert into conversations(kind) values('direct') returning id`,[]);
         cid=created.rows[0].id;
         await q(`insert into conversation_members(conversation_id,user_id) values($1,$2),($1,$3)`,[cid,uid,to]);
       }
     }catch{
       const created=await sb('conversations','POST',{kind:'direct'},ctx.token);
       if(Array.isArray(created)&&created[0]){
         cid=created[0].id;
         await sb('conversation_members','POST',[{conversation_id:cid,user_id:uid},{conversation_id:cid,user_id:to}],ctx.token);
       }
     }
     const targetClient=clients.get(targetA2L);
     const isOnline=targetClient&&targetClient.ws.readyState===1;
     let msgRow=null;
     try{
       const m=await q(`insert into messages(conversation_id,sender_id,body,delivered_at) values($1,$2,$3,$4) returning *`,[cid,uid,text,isOnline?new Date():null]);
       msgRow=m.rows[0];
     }catch{
       const ins=await sb('messages','POST',{conversation_id:cid,sender_id:uid,body:text,delivered_at:isOnline?new Date().toISOString():null},ctx.token);
       if(Array.isArray(ins)&&ins[0])msgRow=ins[0];
       else msgRow={id:crypto.randomUUID(),conversation_id:cid,sender_id:uid,body:text,created_at:new Date().toISOString()};
     }
     const clientPayload={id:msgRow.id,body:text,sender_id:id,senderA2L:id,mine:false,created_at:msgRow.created_at,at:new Date(msgRow.created_at).getTime(),status:isOnline?'delivered':'sent'};
     if(isOnline){
       send(targetClient.ws,{type:'chat-message',from:id,conversationId:cid,message:clientPayload});
     }
     await notify(targetA2L,'message',id,{message:msgRow,conversationId:cid,text:text.slice(0,100)});
     return json(res,201,{...msgRow,mine:true,at:new Date(msgRow.created_at).getTime(),status:isOnline?'delivered':'sent'});
   }
   if(req.method==='POST'&&parts[1]==='conversation'&&parts[2]==='read'){
     const targetA2L=cleanId(body.to||url.searchParams.get('to'));
     const t=await profileByA2L(targetA2L,ctx.token),to=t.rows[0]?.id;
     if(!to)return json(res,400,{error:'Invalid user'});
     let cid=null;
     try{
       const cr=await q(`select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,[uid,to]);
       cid=cr.rows[0]?.id;
       if(cid){
         await q(`update messages set read_at=now() where conversation_id=$1 and sender_id=$2 and read_at is null`,[cid,to]);
       }
     }catch{
       const convs=await sb(`conversation_members?user_id=eq.${uid}&select=conversation_id`,'GET',null,ctx.token);
       if(Array.isArray(convs)&&convs.length){
         const cids=convs.map(c=>c.conversation_id);
         await sb(`messages?conversation_id=in.(${cids.join(',')})&sender_id=eq.${to}&read_at=is.null`,'PATCH',{read_at:new Date().toISOString()},ctx.token);
       }
     }
     const tc=clients.get(targetA2L);
     if(tc&&tc.ws.readyState===1){
       send(tc.ws,{type:'messages-read',conversationId:cid,by:id,readAt:new Date().toISOString()});
     }
     return json(res,200,{ok:true});
   }
   if(req.method==='GET'&&parts[1]==='messages'&&parts[2]){
     try{const r=await q(`select m.* from messages m join conversation_members cm on cm.conversation_id=m.conversation_id where m.conversation_id=$1 and cm.user_id=$2 order by m.created_at asc limit 500`,[parts[2],uid]);return json(res,200,r.rows);}catch{}
     const rest=await sb(`messages?conversation_id=eq.${parts[2]}&order=created_at.asc&limit=500`,'GET',null,ctx.token);
     return json(res,200,Array.isArray(rest)?rest:[]);
   }
   if(req.method==='GET'&&parts[1]==='conversation'){
     const targetA2L=cleanId(url.searchParams.get('to'));
     const t=await profileByA2L(targetA2L,ctx.token),to=t.rows[0]?.id;if(!to)return json(res,400,{error:'Invalid user'});
     let cid=null,msgs=[];
     try{
       const c=await q(`select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,[uid,to]);
       if(c.rows[0]){
         cid=c.rows[0].id;
         q(`update messages set read_at=now() where conversation_id=$1 and sender_id=$2 and read_at is null`,[cid,to]).catch(()=>{});
         const r=await q('select * from messages where conversation_id=$1 order by created_at asc limit 500',[cid]);
         msgs=r.rows;
       }
     }catch{
       const convs=await sb(`conversation_members?user_id=eq.${uid}&select=conversation_id`,'GET',null,ctx.token);
       if(Array.isArray(convs)&&convs.length){
         const cids=convs.map(c=>c.conversation_id);
         const m=await sb(`messages?conversation_id=in.(${cids.join(',')})&order=created_at.asc&limit=500`,'GET',null,ctx.token);
         if(Array.isArray(m))msgs=m;
       }
     }
     const tc=clients.get(targetA2L);
     if(tc&&tc.ws.readyState===1){
       send(tc.ws,{type:'messages-read',conversationId:cid,by:id,readAt:new Date().toISOString()});
     }
     return json(res,200,{id:cid,messages:msgs});
   }
  return json(res,404,{error:'Not found'});
 }catch(e){console.error('api',e);return json(res,e.status||500,{error:e.message||'Server error'});}
}
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));return true}
function readBody(req){return new Promise(resolve=>{let s='';req.on('data',d=>{s+=d;if(s.length>1024*1024)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{resolve({})}})})}
async function handle(c,m){const type=m?.type;if(type==='register'){const ctx=await authenticateWs(m.token,m.id);const id=ctx.a2lId;const old=clients.get(id);if(old&&old!==c){try{old.ws.close(4001,'replaced')}catch{};await endPair(old,false)}c.id=id;c.authUserId=ctx.user.id;c.token=m.token;c.profile=m.profile||{};c.prefs={};c.busy=false;c.peerId=null;c.public={a2lId:id,displayName:c.profile.displayName||ctx.profile?.display_name||'A2L user',avatar:c.profile.avatar||ctx.profile?.avatar_url||'🙂',photoData:c.profile.photoData||ctx.profile?.photo_data||'',ageGroup:c.profile.ageGroup||ctx.profile?.age_group||'',languages:c.profile.languages||ctx.profile?.languages||[],interests:c.profile.interests||ctx.profile?.interests||[],location:c.profile.location||ctx.profile?.location||''};clients.set(id,c);try{await ensureProfile(c,c.profile)}catch(e){console.error('profile save',e.message)}send(c.ws,{type:'registered',id,database:!!pool,auth:true});return}if(!c.id)return send(c.ws,{type:'error',message:'Register first'});if(type==='profile-update'){c.profile={...c.profile,...(m.profile||{})};c.public={...c.public,...m.profile,a2lId:c.id};try{await ensureProfile(c,c.profile)}catch(e){send(c.ws,{type:'error',message:'Profile save failed'})}send(c.ws,{type:'profile-saved'});return}if(type==='find-match'){await endPair(c,false);c.prefs=m.prefs||{};await pair(c);return}if(type==='cancel-match'){await endPair(c,true,'cancelled');send(c.ws,{type:'cancelled'});return}if(['call-invite','call-accept','call-declined','call-busy'].includes(type)){
 const to=cleanId(m.to),p=clients.get(to);if(!p)return send(c.ws,{type:'call-unavailable',to});
 if(type==='call-invite'){const allowed=await canCall(c,p);if(!allowed.ok)return send(c.ws,{type:allowed.reason==='blocked'?'call-blocked':allowed.reason==='privacy'?'call-unavailable':'call-busy',to,from:p.id});c.busy=true;c.peerId=p.id;p.busy=true;p.peerId=c.id;c.historyId=await saveHistory(c,p,'direct');p.historyId=c.historyId}
 else if(!c.peerId||c.peerId!==p.id||!p.peerId||p.peerId!==c.id)return send(c.ws,{type:'error',message:'Call session is not active',status:409});
 send(p.ws,{...m,from:c.id,fromName:c.profile.displayName||'A2L user',fromAvatar:c.profile.avatar||'🙂',fromPhotoData:c.profile.photoData||''});
 if(type==='call-declined'||type==='call-busy')await endPair(c,false,type==='call-declined'?'declined':'busy');
 return}if(['offer','answer','ice','reaction','match-state'].includes(type)){const p=peer(c);if(!p||await isBlocked(c.id,p.id))return send(c.ws,{type:'call-blocked'});if((type==='offer'||type==='answer')&&!m.description)return send(c.ws,{type:'error',message:`Missing ${type} description`,status:400});if(type==='ice'&&!m.candidate)return send(c.ws,{type:'error',message:'Missing ICE candidate',status:400});relay(c,m);return}if(type==='hangup'){relay(c,{type:'hangup',reason:m.reason||'peer-ended'});await endPair(c,false,m.reason||'ended');return}}
const server=http.createServer(async(req,res)=>{try{if(req.url.startsWith('/api/')){const body=await readBody(req);await api(req,res,body);return}const raw=(req.url||'/').split('?')[0];let file=raw==='/'?'/index.html':raw;file=path.normalize(file).replace(/^([.][.][/\\])+/, '');const full=path.join(ROOT,file);if(!full.startsWith(ROOT)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end('Not found')}const ext=path.extname(full).toLowerCase();res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream','cache-control':'no-cache'});fs.createReadStream(full).pipe(res)}catch(e){console.error(e);if(!res.headersSent)json(res,e.status||500,{error:e.message||'Server error'})}});
const wss=new WebSocketServer({server});wss.on('connection',ws=>{const c={ws,id:null,authUserId:null,profile:{},prefs:{},busy:false,peerId:null,historyId:null};ws.on('message',raw=>{handle(c,JSON.parse(raw.toString())).catch(e=>send(ws,{type:'error',message:e.message||'Realtime error',status:e.status||500}))});ws.on('close',()=>{if(c.id&&clients.get(c.id)===c){endPair(c,true).catch(()=>{});clients.delete(c.id)}removeQueue(c.id)});ws.on('error',()=>{})});
setInterval(()=>{for(const[id,c]of clients)if(c.ws.readyState!==1){endPair(c,false).catch(()=>{});clients.delete(id)}},30000);
server.listen(PORT,()=>console.log(`Alone2Lone realtime server on ${PORT}; DB=${!!pool}; Auth=${REQUIRE_AUTH&&!!SUPABASE_URL}`));
