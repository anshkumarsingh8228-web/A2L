const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');

const ROOT = __dirname;

// Load local .env file if present
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
  } catch (e) {
    console.warn('.env read error:', e.message);
  }
}

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TURN_URL = process.env.TURN_URL || '';
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 10)
    })
  : null;

// In-memory persistence fallback for when DATABASE_URL is not configured (offline/dev mode)
const mem = {
  profiles: new Map(), // uid -> profileRow
  a2lToUid: new Map(), // a2lId -> uid
  friendships: new Set(), // "uidA:uidB" sorted
  friendRequests: new Map(), // id -> row
  chatRequests: new Map(), // id -> row
  conversations: new Map(), // id -> { id, kind, members: Set([uidA, uidB]) }
  messages: new Map(), // conversationId -> array of message objects
  connectionHistory: new Map(), // id -> row
  reconnectRequests: new Map(), // id -> row
  notifications: new Map(), // uid -> array of notification objects
  blocks: new Set(), // "blockerUid:blockedUid"
  reports: []
};

const clients = new Map(); // a2lId -> client object
const queue = []; // a2lIds waiting for random match

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const send = (ws, m) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify(m));
};

const cleanId = v =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_\-]/g, '')
    .slice(0, 40);

const q = async (text, params = []) => {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
};

const profileOf = c => c?.profile || {};
const authCache = new Map();

function bearer(headers) {
  const h = headers?.authorization || '';
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : '';
}

function generateGuestUuid(a2lId) {
  const hash = crypto.createHash('md5').update(a2lId || crypto.randomBytes(8).toString('hex')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function verifyToken(token, fallbackId = '') {
  if (!REQUIRE_AUTH && (!token || !SUPABASE_URL)) {
    const guestA2L = cleanId(fallbackId) || `guest_${crypto.randomBytes(3).toString('hex')}`;
    const guestUid = generateGuestUuid(guestA2L);
    return {
      id: guestUid,
      email: `${guestA2L}@guest.alone2lone`,
      user_metadata: { a2l_id: guestA2L, display_name: 'Guest User' },
      isGuest: true
    };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (!REQUIRE_AUTH) {
      const guestA2L = cleanId(fallbackId) || `guest_${crypto.randomBytes(3).toString('hex')}`;
      return {
        id: generateGuestUuid(guestA2L),
        email: `${guestA2L}@guest.alone2lone`,
        user_metadata: { a2l_id: guestA2L, display_name: 'Guest User' },
        isGuest: true
      };
    }
    throw Object.assign(new Error('Supabase Auth is not configured on the server'), { status: 503 });
  }

  if (!token) {
    if (!REQUIRE_AUTH) {
      const guestA2L = cleanId(fallbackId) || `guest_${crypto.randomBytes(3).toString('hex')}`;
      return {
        id: generateGuestUuid(guestA2L),
        email: `${guestA2L}@guest.alone2lone`,
        user_metadata: { a2l_id: guestA2L, display_name: 'Guest User' },
        isGuest: true
      };
    }
    throw Object.assign(new Error('Authentication required'), { status: 401 });
  }

  const cached = authCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;

  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });

  if (!r.ok) throw Object.assign(new Error('Invalid or expired authentication session'), { status: 401 });
  const user = await r.json();
  if (!user?.id) throw Object.assign(new Error('Invalid authentication session'), { status: 401 });

  authCache.set(token, { user, expires: Date.now() + 30000 });
  return user;
}

async function authContextFromUser(user, requestedId = '') {
  if (!user?.id) {
    const guestA2L = cleanId(requestedId) || `guest_${crypto.randomBytes(3).toString('hex')}`;
    const guestUid = generateGuestUuid(guestA2L);
    user = { id: guestUid, email: `${guestA2L}@guest.alone2lone`, user_metadata: { a2l_id: guestA2L, display_name: 'Guest User' } };
  }

  if (pool) {
    const existing = await q('select * from profiles where id=$1', [user.id]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return {
        user,
        a2lId: row.a2l_id || row.username || `a2l_${user.id.slice(0, 8)}`,
        profile: row
      };
    }
    const desired = cleanId(requestedId || user.user_metadata?.a2l_id || user.user_metadata?.username || '');
    const id = desired || `a2l_${user.id.slice(0, 8)}`;
    const collision = await q('select 1 from profiles where a2l_id=$1', [id]);
    if (collision.rows[0]) throw Object.assign(new Error('A2L ID is already in use'), { status: 409 });
    await q('insert into profiles(id,a2l_id,username,display_name) values($1,$2,$2,$3)', [
      user.id,
      id,
      user.user_metadata?.display_name || user.email?.split('@')[0] || 'A2L user'
    ]);
    return { user, a2lId: id, profile: null };
  }

  // In-memory fallback
  let row = mem.profiles.get(user.id);
  if (row) {
    return { user, a2lId: row.a2l_id, profile: row };
  }
  const desired = cleanId(requestedId || user.user_metadata?.a2l_id || user.user_metadata?.username || '');
  const id = desired || `a2l_${user.id.slice(0, 8)}`;
  if (mem.a2lToUid.has(id) && mem.a2lToUid.get(id) !== user.id) {
    throw Object.assign(new Error('A2L ID is already in use'), { status: 409 });
  }
  row = {
    id: user.id,
    a2l_id: id,
    username: id,
    display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'A2L user',
    avatar_url: '🙂',
    photo_data: '',
    bio: 'Friendship-first • Here to meet interesting people.',
    location: '',
    age_group: '16-17',
    languages: ['english'],
    interests: ['Gaming', 'Music'],
    looking_for: ['Friendship'],
    visibility: 'public',
    privacy: {},
    match_prefs: {},
    updated_at: new Date().toISOString()
  };
  mem.profiles.set(user.id, row);
  mem.a2lToUid.set(id, user.id);
  return { user, a2lId: id, profile: row };
}

async function authenticateHttp(req, requestedId = '') {
  const token = bearer(req.headers);
  const user = await verifyToken(token, requestedId);
  return authContextFromUser(user, requestedId);
}

async function authenticateWs(token, requestedId = '') {
  const user = await verifyToken(token, requestedId);
  return authContextFromUser(user, requestedId);
}

async function ensureProfile(c, p = {}) {
  if (!c?.authUserId) return;
  if (pool) {
    await q(
      `update profiles set username=coalesce($2,username),display_name=$3,avatar_url=$4,photo_data=coalesce($5,photo_data),bio=$6,location=$7,age_group=$8,languages=$9,interests=$10,looking_for=$11,visibility=$12,privacy=$13,match_prefs=$14,updated_at=now(),a2l_id=coalesce(a2l_id,$2) where id=$1`,
      [
        c.authUserId,
        cleanId(c.id),
        p.displayName || 'A2L user',
        p.avatar || null,
        p.photoData || null,
        p.bio || '',
        p.location || p.city || '',
        p.ageGroup || '',
        p.languages || [],
        p.interests || [],
        p.lookingFor || [],
        p.visibility || 'public',
        JSON.stringify(p.privacy || {}),
        JSON.stringify(p.matchPrefs || {})
      ]
    );
  } else {
    const row = mem.profiles.get(c.authUserId) || { id: c.authUserId };
    row.a2l_id = cleanId(c.id);
    row.display_name = p.displayName || row.display_name || 'A2L user';
    row.avatar_url = p.avatar || row.avatar_url || '🙂';
    if (p.photoData) row.photo_data = p.photoData;
    row.bio = p.bio !== undefined ? p.bio : row.bio || '';
    row.location = p.location || p.city || row.location || '';
    row.age_group = p.ageGroup || row.age_group || '';
    row.languages = p.languages || row.languages || ['english'];
    row.interests = p.interests || row.interests || [];
    row.looking_for = p.lookingFor || row.looking_for || [];
    row.visibility = p.visibility || row.visibility || 'public';
    row.privacy = p.privacy || row.privacy || {};
    row.match_prefs = p.matchPrefs || row.match_prefs || {};
    row.updated_at = new Date().toISOString();
    mem.profiles.set(c.authUserId, row);
    mem.a2lToUid.set(row.a2l_id, c.authUserId);
  }
}

function publicPeerRow(r) {
  return {
    id: r.id,
    a2lId: r.a2l_id || r.username || `a2l_${String(r.id).slice(0, 8)}`,
    displayName: r.display_name || 'A2L user',
    avatar: r.avatar_url || '🙂',
    photoData: r.photo_data || '',
    ageGroup: r.age_group || '',
    languages: Array.isArray(r.languages) ? r.languages : [],
    interests: Array.isArray(r.interests) ? r.interests : [],
    location: r.location || '',
    bio: r.bio || ''
  };
}

async function profileByA2L(a2l) {
  const clean = cleanId(a2l);
  if (pool) {
    return q('select * from profiles where a2l_id=$1', [clean]);
  }
  const uid = mem.a2lToUid.get(clean);
  const row = uid ? mem.profiles.get(uid) : null;
  return { rows: row ? [row] : [] };
}

async function isBlocked(a, b) {
  if (!a || !b) return false;
  const ca = cleanId(a), cb = cleanId(b);
  if (pool) {
    const r = await q(
      `select 1 from blocks bl join profiles pa on pa.id=bl.blocker_id join profiles pb on pb.id=bl.blocked_id where (pa.a2l_id=$1 and pb.a2l_id=$2) or (pa.a2l_id=$2 and pb.a2l_id=$1) limit 1`,
      [ca, cb]
    );
    return !!r.rows[0];
  }
  const uidA = mem.a2lToUid.get(ca), uidB = mem.a2lToUid.get(cb);
  if (!uidA || !uidB) return false;
  return mem.blocks.has(`${uidA}:${uidB}`) || mem.blocks.has(`${uidB}:${uidA}`);
}

async function areConnected(a, b) {
  if (!a?.authUserId || !b?.authUserId) return false;
  if (pool) {
    try {
      const r = await q(
        'select 1 from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1) limit 1',
        [a.authUserId, b.authUserId]
      );
      return !!r.rows[0];
    } catch {
      return false;
    }
  }
  const pairKey = [a.authUserId, b.authUserId].sort().join(':');
  return mem.friendships.has(pairKey);
}

function privacyValue(c, key, fallback) {
  return profileOf(c)?.privacy?.[key] || fallback;
}

async function canCall(c, p) {
  if (!c || !p || c.id === p.id) return { ok: false, reason: 'busy' };
  if (await isBlocked(c.id, p.id)) return { ok: false, reason: 'blocked' };
  if (p.busy) return { ok: false, reason: 'busy' };
  const setting = privacyValue(p, 'call', 'everyone');
  if (setting === 'nobody') return { ok: false, reason: 'privacy' };
  if (setting === 'connected' && !(await areConnected(c, p))) return { ok: false, reason: 'privacy' };
  return { ok: true };
}

async function compatible(a, b) {
  if (!a || !b || a.id === b.id || a.busy || b.busy) return false;
  const aa = a.prefs || {}, bb = b.prefs || {}, pa = profileOf(a), pb = profileOf(b);
  if (aa.online === false || bb.online === false) return false;
  if (pa?.privacy?.search === false || pb?.privacy?.search === false) return false;
  if (await isBlocked(a.id, b.id)) return false;
  if (aa.mode && aa.mode !== 'any' && bb.mode && bb.mode !== 'any' && aa.mode !== bb.mode) return false;
  if (aa.age === 'same' && pa.ageGroup && pb.ageGroup && pa.ageGroup !== pb.ageGroup) return false;
  if (bb.age === 'same' && pa.ageGroup && pb.ageGroup && pa.ageGroup !== pb.ageGroup) return false;
  if (aa.interest && aa.interest !== 'any' && !(pb.interests || []).includes(aa.interest)) return false;
  if (bb.interest && bb.interest !== 'any' && !(pa.interests || []).includes(bb.interest)) return false;
  return true;
}

function removeQueue(id) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] === id) queue.splice(i, 1);
  }
}

async function saveHistory(a, b, type = 'random') {
  if (!a?.authUserId || !b?.authUserId) return null;
  if (pool) {
    try {
      const r = await q(
        `insert into connection_history(user_a,user_b,session_type) values($1,$2,$3) returning id`,
        [a.authUserId, b.authUserId, type]
      );
      return r.rows[0]?.id;
    } catch (e) {
      console.error('history', e.message);
      return null;
    }
  }
  const id = crypto.randomUUID();
  mem.connectionHistory.set(id, {
    id,
    user_a: a.authUserId,
    user_b: b.authUserId,
    session_type: type,
    started_at: new Date().toISOString(),
    reconnectable: true,
    last_seen_at: new Date().toISOString()
  });
  return id;
}

async function notify(userA2L, type, actorA2L, payload = {}) {
  try {
    const [u, a] = await Promise.all([profileByA2L(userA2L), actorA2L ? profileByA2L(actorA2L) : Promise.resolve({ rows: [] })]);
    const uid = u.rows[0]?.id, aid = a.rows[0]?.id || null;
    if (!uid) return;

    if (pool) {
      await q(`insert into notifications(user_id,type,actor_id,payload) values($1,$2,$3,$4)`, [
        uid,
        type,
        aid,
        JSON.stringify(payload)
      ]);
    } else {
      const notifs = mem.notifications.get(uid) || [];
      notifs.unshift({
        id: crypto.randomUUID(),
        user_id: uid,
        type,
        actor_id: aid,
        payload,
        created_at: new Date().toISOString()
      });
      mem.notifications.set(uid, notifs.slice(0, 100));
    }

    const c = clients.get(userA2L);
    if (c) {
      send(c.ws, {
        type: 'notification',
        notification: { type, actorId: actorA2L, payload, createdAt: new Date().toISOString() }
      });
    }
  } catch (e) {
    console.error('notify', e.message);
  }
}

let pairingLock = Promise.resolve();
async function pair(c) {
  const run = pairingLock.then(async () => {
    if (!c || c.busy) return;
    removeQueue(c.id);
    for (let i = 0; i < queue.length; i++) {
      const other = clients.get(queue[i]);
      if (!other || other.ws.readyState !== 1 || other.busy) {
        queue.splice(i, 1);
        i--;
        continue;
      }
      if (!(await compatible(c, other))) continue;
      
      if (!c.id || c.busy || !other.id || other.busy || other.ws.readyState !== 1) {
        continue;
      }
      
      queue.splice(i, 1);
      c.busy = other.busy = true;
      c.peerId = other.id;
      c.historyId = await saveHistory(c, other, c.prefs?.mode === 'voice' || other.prefs?.mode === 'voice' ? 'voice' : 'random');
      other.peerId = c.id;
      other.historyId = c.historyId;
      const mode = c.prefs?.mode && c.prefs.mode !== 'any' ? c.prefs.mode : other.prefs?.mode && other.prefs.mode !== 'any' ? other.prefs.mode : 'video';
      send(c.ws, { type: 'match-found', peer: other.public, mode, initiator: true, historyId: c.historyId });
      send(other.ws, { type: 'match-found', peer: c.public, mode, initiator: false, historyId: c.historyId });
      return;
    }
    if (!c.busy) {
      queue.push(c.id);
      send(c.ws, { type: 'waiting' });
    }
  });
  pairingLock = run.catch(() => {});
  return run;
}

function peer(c) {
  return c?.peerId ? clients.get(c.peerId) : null;
}
function relay(c, m) {
  const p = peer(c);
  if (p) send(p.ws, m);
}

async function endPair(c, notifyPeer = true, outcome = 'ended') {
  removeQueue(c?.id);
  const p = peer(c);
  if (c?.historyId) {
    if (pool) {
      q(`update connection_history set ended_at=now(),outcome=$1,last_seen_at=now() where id=$2`, [outcome, c.historyId]).catch(() => {});
    } else {
      const h = mem.connectionHistory.get(c.historyId);
      if (h) {
        h.ended_at = new Date().toISOString();
        h.outcome = outcome;
        h.last_seen_at = new Date().toISOString();
      }
    }
  }
  c.busy = false;
  c.peerId = null;
  c.historyId = null;
  if (p) {
    p.busy = false;
    p.peerId = null;
    p.historyId = null;
    if (notifyPeer) send(p.ws, { type: 'hangup', reason: 'peer-ended' });
  }
}

async function api(req, res, body) {
  const url = new URL(req.url, `http://${req.headers.host}`),
    parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/api/health')
    return json(res, 200, { ok: true, database: !!pool, auth: REQUIRE_AUTH && !!SUPABASE_URL });

  if (req.method === 'GET' && url.pathname === '/api/config')
    return json(res, 200, { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, authRequired: REQUIRE_AUTH });

  if (req.method === 'GET' && url.pathname === '/api/rtc-config') {
    return json(res, 200, {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        ...(TURN_URL ? [{ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL }] : [])
      ]
    });
  }

  if (parts[0] !== 'api') return false;

  let ctx;
  try {
    ctx = await authenticateHttp(req, req.headers['x-a2l-id'] || body?.profile?.a2lId || url.searchParams.get('user'));
  } catch (e) {
    return json(res, e.status || 401, { error: e.message });
  }

  const id = ctx.a2lId, uid = ctx.user.id;

  try {
    // Discovery: list or search registered users
    if (req.method === 'GET' && parts[1] === 'users') {
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      if (pool) {
        const query = search
          ? q(
              `select * from profiles where (lower(a2l_id) like $1 or lower(display_name) like $1) and id <> $2 and visibility='public' limit 30`,
              [`%${search}%`, uid]
            )
          : q(`select * from profiles where id <> $1 and visibility='public' order by updated_at desc limit 30`, [uid]);
        const r = await query;
        return json(res, 200, r.rows.map(publicPeerRow));
      } else {
        const list = Array.from(mem.profiles.values())
          .filter(p => p.id !== uid && p.visibility === 'public')
          .filter(p => !search || p.a2l_id.includes(search) || p.display_name.toLowerCase().includes(search))
          .slice(0, 30);
        return json(res, 200, list.map(publicPeerRow));
      }
    }

    if (req.method === 'PUT' && parts[1] === 'profile') {
      const p = { ...(body.profile || body) };
      delete p.a2lId;
      await ensureProfile({ id, authUserId: uid }, p);
      return json(res, 200, { ok: true, a2lId: id });
    }

    if (req.method === 'GET' && parts[1] === 'me') {
      if (pool) {
        const r = await q('select * from profiles where id=$1', [uid]);
        return json(res, 200, r.rows[0] ? publicPeerRow(r.rows[0]) : null);
      } else {
        const row = mem.profiles.get(uid);
        return json(res, 200, row ? publicPeerRow(row) : null);
      }
    }

    if (req.method === 'GET' && parts[1] === 'profile' && parts[2]) {
      const r = await profileByA2L(parts[2]);
      return json(res, 200, r.rows[0] ? publicPeerRow(r.rows[0]) : null);
    }

    if (req.method === 'GET' && parts[1] === 'notifications') {
      if (pool) {
        const r = await q('select * from notifications where user_id=$1 order by created_at desc limit 100', [uid]);
        return json(res, 200, r.rows);
      } else {
        return json(res, 200, mem.notifications.get(uid) || []);
      }
    }

    if (req.method === 'GET' && parts[1] === 'requests') {
      if (pool) {
        const [f, c, r] = await Promise.all([
          q(
            "select fr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,pr.a2l_id as to_a2l_id from friend_requests fr join profiles ps on ps.id=fr.sender_id join profiles pr on pr.id=fr.receiver_id where (fr.receiver_id=$1 or fr.sender_id=$1) and fr.status='pending' order by fr.created_at desc limit 100",
            [uid]
          ),
          q(
            "select cr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,pr.a2l_id as to_a2l_id from chat_requests cr join profiles ps on ps.id=cr.sender_id join profiles pr on pr.id=cr.receiver_id where (cr.receiver_id=$1 or cr.sender_id=$1) and cr.status='pending' order by cr.created_at desc limit 100",
            [uid]
          ),
          q(
            "select rr.*,ps.a2l_id as from_a2l_id,ps.display_name as from_name,pr.a2l_id as to_a2l_id from reconnect_requests rr join profiles ps on ps.id=rr.from_user join profiles pr on pr.id=rr.to_user where (rr.to_user=$1 or rr.from_user=$1) and rr.status='pending' order by rr.created_at desc limit 100",
            [uid]
          )
        ]);
        const norm = rows => rows.map(x => ({ ...x, from: x.from_a2l_id, to: x.to_a2l_id, from_user: x.from_a2l_id, to_user: x.to_a2l_id, fromName: x.from_name }));
        return json(res, 200, { friends: norm(f.rows), chats: norm(c.rows), reconnects: norm(r.rows) });
      } else {
        const fr = Array.from(mem.friendRequests.values()).filter(x => (x.sender_id === uid || x.receiver_id === uid) && x.status === 'pending');
        const cr = Array.from(mem.chatRequests.values()).filter(x => (x.sender_id === uid || x.receiver_id === uid) && x.status === 'pending');
        const rr = Array.from(mem.reconnectRequests.values()).filter(x => (x.from_user === uid || x.to_user === uid) && x.status === 'pending');
        const norm = rows =>
          rows.map(x => {
            const sender = mem.profiles.get(x.sender_id || x.from_user);
            const receiver = mem.profiles.get(x.receiver_id || x.to_user);
            return {
              ...x,
              from: sender?.a2l_id || 'unknown',
              to: receiver?.a2l_id || 'unknown',
              from_user: sender?.a2l_id || 'unknown',
              to_user: receiver?.a2l_id || 'unknown',
              fromName: sender?.display_name || 'A2L user'
            };
          });
        return json(res, 200, { friends: norm(fr), chats: norm(cr), reconnects: norm(rr) });
      }
    }

    if (req.method === 'POST' && parts[1] === 'report') {
      const to = cleanId(body.to), t = await profileByA2L(to);
      if (!t.rows[0] || to === id) return json(res, 400, { error: 'Invalid reported user' });
      const reason = String(body.reason || 'Other').trim().slice(0, 500) || 'Other';
      const context = String(body.context || 'general').slice(0, 40);
      const targetId = t.rows[0].id;
      if (pool) {
        const r = await q(`insert into reports(reporter_id,reported_id,category,details) values($1,$2,$3,$4) returning id,created_at`, [
          uid,
          targetId,
          reason,
          context
        ]);
        return json(res, 201, { ok: true, id: r.rows[0].id, createdAt: r.rows[0].created_at });
      } else {
        const rep = { id: crypto.randomUUID(), reporter_id: uid, reported_id: targetId, category: reason, details: context, created_at: new Date().toISOString() };
        mem.reports.push(rep);
        return json(res, 201, { ok: true, id: rep.id, createdAt: rep.created_at });
      }
    }

    if (req.method === 'POST' && parts[1] === 'block') {
      const to = cleanId(body.to), t = await profileByA2L(to);
      if (!t.rows[0] || to === id) return json(res, 400, { error: 'Invalid user' });
      const targetId = t.rows[0].id;
      if (pool) {
        await q('insert into blocks(blocker_id,blocked_id) values($1,$2) on conflict(blocker_id,blocked_id) do nothing', [uid, targetId]);
        try { await q('delete from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1)', [uid, targetId]); } catch {}
        try { await q("update friend_requests set status='cancelled',updated_at=now() where status='pending' and ((sender_id=$1 and receiver_id=$2) or (sender_id=$2 and receiver_id=$1))", [uid, targetId]); } catch {}
        try { await q("update chat_requests set status='cancelled',updated_at=now() where status='pending' and ((sender_id=$1 and receiver_id=$2) or (sender_id=$2 and receiver_id=$1))", [uid, targetId]); } catch {}
      } else {
        mem.blocks.add(`${uid}:${targetId}`);
        mem.friendships.delete([uid, targetId].sort().join(':'));
      }
      const target = clients.get(to);
      if (target) {
        send(target.ws, { type: 'blocked', by: id });
        await endPair(target, true, 'blocked');
      }
      return json(res, 201, { ok: true });
    }

    if (req.method === 'POST' && parts[1] === 'friend-request') {
      const targetA2L = cleanId(body.to), t = await profileByA2L(targetA2L), to = t.rows[0]?.id;
      if (!to || to === uid) return json(res, 400, { error: 'Invalid users' });
      if (await isBlocked(id, targetA2L)) return json(res, 403, { error: 'User is blocked' });
      if (t.rows[0].privacy?.requests === false) return json(res, 403, { error: 'Connection requests are disabled' });

      if (pool) {
        const r = await q(
          `insert into friend_requests(sender_id,receiver_id,status) values($1,$2,'pending') on conflict(sender_id,receiver_id) do update set status='pending',updated_at=now() returning *`,
          [uid, to]
        );
        await notify(targetA2L, 'friend_request', id, { requestId: r.rows[0].id, request: r.rows[0] });
        return json(res, 201, r.rows[0]);
      } else {
        const reqId = crypto.randomUUID();
        const row = { id: reqId, sender_id: uid, receiver_id: to, status: 'pending', created_at: new Date().toISOString() };
        mem.friendRequests.set(reqId, row);
        await notify(targetA2L, 'friend_request', id, { requestId: reqId, request: row });
        return json(res, 201, row);
      }
    }

    if (req.method === 'POST' && parts[1] === 'friend-response') {
      if (pool) {
        const r = await q('select * from friend_requests where id=$1 and receiver_id=$2', [body.requestId, uid]);
        if (!r.rows[0]) return json(res, 404, { error: 'Request not found' });
        const x = r.rows[0], status = body.accepted ? 'accepted' : 'declined';
        await q('update friend_requests set status=$1,updated_at=now() where id=$2', [status, body.requestId]);
        const from = await q('select a2l_id from profiles where id=$1', [x.sender_id]);
        if (body.accepted) {
          const [a, b] = [x.sender_id, x.receiver_id].sort();
          await q(`insert into friendships(user_a,user_b) values($1,$2) on conflict do nothing`, [a, b]);
        }
        await notify(from.rows[0]?.a2l_id, body.accepted ? 'friend_accepted' : 'friend_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      } else {
        const r = mem.friendRequests.get(body.requestId);
        if (!r || r.receiver_id !== uid) return json(res, 404, { error: 'Request not found' });
        r.status = body.accepted ? 'accepted' : 'declined';
        if (body.accepted) {
          mem.friendships.add([r.sender_id, r.receiver_id].sort().join(':'));
        }
        const sender = mem.profiles.get(r.sender_id);
        await notify(sender?.a2l_id, body.accepted ? 'friend_accepted' : 'friend_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && parts[1] === 'friends') {
      if (pool) {
        const r = await q(
          `select p.* from profiles p join friendships f on ((f.user_a=$1 and f.user_b=p.id) or (f.user_b=$1 and f.user_a=p.id))`,
          [uid]
        );
        return json(res, 200, r.rows.map(publicPeerRow));
      } else {
        const friendRows = [];
        for (const pairKey of mem.friendships) {
          const [a, b] = pairKey.split(':');
          if (a === uid && mem.profiles.has(b)) friendRows.push(mem.profiles.get(b));
          else if (b === uid && mem.profiles.has(a)) friendRows.push(mem.profiles.get(a));
        }
        return json(res, 200, friendRows.map(publicPeerRow));
      }
    }

    if (req.method === 'POST' && parts[1] === 'chat-request') {
      const targetA2L = cleanId(body.to), t = await profileByA2L(targetA2L), to = t.rows[0]?.id;
      if (!to || to === uid) return json(res, 400, { error: 'Invalid users' });
      if (await isBlocked(id, targetA2L)) return json(res, 403, { error: 'User is blocked' });

      if (pool) {
        const r = await q(
          `insert into chat_requests(sender_id,receiver_id,status) values($1,$2,'pending') on conflict(sender_id,receiver_id) do update set status='pending',updated_at=now() returning *`,
          [uid, to]
        );
        await notify(targetA2L, 'chat_request', id, { requestId: r.rows[0].id, request: r.rows[0] });
        return json(res, 201, r.rows[0]);
      } else {
        const reqId = crypto.randomUUID();
        const row = { id: reqId, sender_id: uid, receiver_id: to, status: 'pending', created_at: new Date().toISOString() };
        mem.chatRequests.set(reqId, row);
        await notify(targetA2L, 'chat_request', id, { requestId: reqId, request: row });
        return json(res, 201, row);
      }
    }

    if (req.method === 'POST' && parts[1] === 'chat-response') {
      if (pool) {
        const r = await q('select * from chat_requests where id=$1 and receiver_id=$2', [body.requestId, uid]);
        if (!r.rows[0]) return json(res, 404, { error: 'Request not found' });
        const x = r.rows[0];
        await q('update chat_requests set status=$1,updated_at=now() where id=$2', [body.accepted ? 'accepted' : 'declined', body.requestId]);
        const from = await q('select a2l_id from profiles where id=$1', [x.sender_id]);
        await notify(from.rows[0]?.a2l_id, body.accepted ? 'chat_accepted' : 'chat_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      } else {
        const r = mem.chatRequests.get(body.requestId);
        if (!r || r.receiver_id !== uid) return json(res, 404, { error: 'Request not found' });
        r.status = body.accepted ? 'accepted' : 'declined';
        const sender = mem.profiles.get(r.sender_id);
        await notify(sender?.a2l_id, body.accepted ? 'chat_accepted' : 'chat_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && parts[1] === 'history') {
      if (pool) {
        const r = await q(
          `select h.*,case when h.user_a=$1 then h.user_b else h.user_a end as other_id,p.a2l_id as other_a2l_id,p.display_name,p.avatar_url,p.photo_data from connection_history h join profiles p on p.id=case when h.user_a=$1 then h.user_b else h.user_a end where h.user_a=$1 or h.user_b=$1 order by h.last_seen_at desc limit 100`,
          [uid]
        );
        return json(res, 200, r.rows);
      } else {
        const list = Array.from(mem.connectionHistory.values())
          .filter(h => h.user_a === uid || h.user_b === uid)
          .map(h => {
            const otherUid = h.user_a === uid ? h.user_b : h.user_a;
            const p = mem.profiles.get(otherUid);
            return {
              ...h,
              other_id: otherUid,
              other_a2l_id: p?.a2l_id || 'unknown',
              display_name: p?.display_name || 'A2L user',
              avatar_url: p?.avatar_url || '🙂',
              photo_data: p?.photo_data || ''
            };
          });
        return json(res, 200, list);
      }
    }

    if (req.method === 'POST' && parts[1] === 'reconnect') {
      const t = await profileByA2L(body.to), to = t.rows[0]?.id;
      if (!to || to === uid) return json(res, 400, { error: 'Invalid user' });

      if (pool) {
        const valid = await q(
          'select 1 from connection_history where id=$1 and reconnectable=true and (user_a=$2 or user_b=$2) and (case when user_a=$2 then user_b else user_a end)=$3',
          [body.historyId, uid, to]
        );
        if (!valid.rows[0]) return json(res, 400, { error: 'Reconnect history is invalid' });
        const r = await q(`insert into reconnect_requests(from_user,to_user,history_id) values($1,$2,$3) returning *`, [uid, to, body.historyId]);
        await notify(body.to, 'reconnect_request', id, { requestId: r.rows[0].id, historyId: body.historyId });
        return json(res, 201, r.rows[0]);
      } else {
        const reqId = crypto.randomUUID();
        const row = { id: reqId, from_user: uid, to_user: to, history_id: body.historyId, status: 'pending', created_at: new Date().toISOString() };
        mem.reconnectRequests.set(reqId, row);
        await notify(body.to, 'reconnect_request', id, { requestId: reqId, historyId: body.historyId });
        return json(res, 201, row);
      }
    }

    if (req.method === 'POST' && parts[1] === 'reconnect-response') {
      if (pool) {
        const r = await q('select * from reconnect_requests where id=$1 and to_user=$2', [body.requestId, uid]);
        if (!r.rows[0]) return json(res, 404, { error: 'Request not found' });
        const x = r.rows[0];
        await q('update reconnect_requests set status=$1,responded_at=now() where id=$2', [body.accepted ? 'accepted' : 'declined', body.requestId]);
        const from = await q('select a2l_id from profiles where id=$1', [x.from_user]);
        await notify(from.rows[0]?.a2l_id, body.accepted ? 'reconnect_accepted' : 'reconnect_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      } else {
        const r = mem.reconnectRequests.get(body.requestId);
        if (!r || r.to_user !== uid) return json(res, 404, { error: 'Request not found' });
        r.status = body.accepted ? 'accepted' : 'declined';
        const sender = mem.profiles.get(r.from_user);
        await notify(sender?.a2l_id, body.accepted ? 'reconnect_accepted' : 'reconnect_declined', id, { requestId: body.requestId });
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'POST' && parts[1] === 'message') {
      const t = await profileByA2L(body.to), to = t.rows[0]?.id, text = String(body.text || '').trim().slice(0, 2000);
      if (!text || !to) return json(res, 400, { error: 'Invalid message' });
      const targetProfile = t.rows[0];
      if (!targetProfile) return json(res, 404, { error: 'User not found' });
      if (await isBlocked(id, body.to)) return json(res, 403, { error: 'User is blocked' });

      if (pool) {
        const connected = await q(
          `select 1 where exists(select 1 from friendships where (user_a=$1 and user_b=$2) or (user_a=$2 and user_b=$1))`,
          [uid, to]
        );
        const accepted = await q(
          `select 1 where exists(select 1 from chat_requests where ((sender_id=$1 and receiver_id=$2) or (sender_id=$2 and receiver_id=$1)) and status='accepted')`,
          [uid, to]
        );
        const messagePrivacy = targetProfile.privacy?.message || 'everyone';
        const allowed =
          messagePrivacy === 'everyone' ||
          (messagePrivacy === 'connected' && connected.rows[0]) ||
          (messagePrivacy === 'approved' && accepted.rows[0]);
        if (!allowed) return json(res, 403, { error: 'Chat permission required' });

const convLocks = new Set();
// ... inside POST /api/message
        const lockKey = [uid, to].sort().join(':');
        while(convLocks.has(lockKey)) await new Promise(r => setTimeout(r, 50));
        convLocks.add(lockKey);
        let cid;
        try {
          let cr = await q(
            `select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,
            [uid, to]
          );
          cid = cr.rows[0]?.id;
          if (!cid) {
            const created = await q(`insert into conversations(kind) values('direct') returning id`, []);
            cid = created.rows[0].id;
            await q(`insert into conversation_members(conversation_id,user_id) values($1,$2),($1,$3)`, [cid, uid, to]);
          }
        } finally {
          convLocks.delete(lockKey);
        }
        const m = await q(`insert into messages(conversation_id,sender_id,body) values($1,$2,$3) returning *`, [cid, uid, text]);
        const msgRow = { ...m.rows[0], mine: true, sender_a2l_id: id };

        // Relay live message over WebSocket if peer is online
        const peerClient = clients.get(body.to);
        if (peerClient) {
          send(peerClient.ws, {
            type: 'chat-message',
            from: id,
            fromName: ctx.profile?.display_name || 'A2L user',
            text,
            serverId: msgRow.id,
            conversationId: cid,
            at: new Date(msgRow.created_at).getTime()
          });
        }
        await notify(body.to, 'message', id, { message: msgRow, conversationId: cid });
        return json(res, 201, msgRow);
      } else {
        // In-memory conversation handling
        const lockKey = [uid, to].sort().join(':');
        while(convLocks.has(lockKey)) await new Promise(r => setTimeout(r, 50));
        convLocks.add(lockKey);
        let cid = null;
        try {
          for (const [convId, conv] of mem.conversations) {
            if (conv.members.has(uid) && conv.members.has(to) && conv.kind === 'direct') {
              cid = convId;
              break;
            }
          }
          if (!cid) {
            cid = crypto.randomUUID();
            mem.conversations.set(cid, { id: cid, kind: 'direct', members: new Set([uid, to]), created_at: new Date().toISOString() });
          }
        } finally {
          convLocks.delete(lockKey);
        }
        const msgRow = {
          id: crypto.randomUUID(),
          conversation_id: cid,
          sender_id: uid,
          sender_a2l_id: id,
          body: text,
          created_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
          mine: true
        };
        const list = mem.messages.get(cid) || [];
        list.push(msgRow);
        mem.messages.set(cid, list);

        const peerClient = clients.get(body.to);
        if (peerClient) {
          send(peerClient.ws, {
            type: 'chat-message',
            from: id,
            fromName: ctx.profile?.display_name || 'A2L user',
            text,
            serverId: msgRow.id,
            conversationId: cid,
            at: Date.now()
          });
        }
        await notify(body.to, 'message', id, { message: msgRow, conversationId: cid });
        return json(res, 201, msgRow);
      }
    }

    if (req.method === 'GET' && parts[1] === 'messages' && parts[2]) {
      const cid = parts[2];
      if (pool) {
        const r = await q(
          `select m.*, ps.a2l_id as sender_a2l_id from messages m join profiles ps on ps.id=m.sender_id join conversation_members cm on cm.conversation_id=m.conversation_id where m.conversation_id=$1 and cm.user_id=$2 order by m.created_at asc limit 500`,
          [cid, uid]
        );
        const rows = r.rows.map(m => ({ ...m, mine: m.sender_id === uid }));
        return json(res, 200, rows);
      } else {
        const conv = mem.conversations.get(cid);
        if (!conv || !conv.members.has(uid)) return json(res, 200, []);
        const list = (mem.messages.get(cid) || []).map(m => ({
          ...m,
          mine: m.sender_id === uid
        }));
        return json(res, 200, list);
      }
    }

    if (req.method === 'GET' && parts[1] === 'conversation') {
      const targetA2L = cleanId(url.searchParams.get('to'));
      const t = await profileByA2L(targetA2L);
      const to = t.rows[0]?.id;
      if (!to) return json(res, 400, { error: 'Invalid user' });

      if (pool) {
        const c = await q(
          `select c.id from conversations c join conversation_members m1 on m1.conversation_id=c.id join conversation_members m2 on m2.conversation_id=c.id where c.kind='direct' and m1.user_id=$1 and m2.user_id=$2 limit 1`,
          [uid, to]
        );
        if (!c.rows[0]) return json(res, 200, { id: null, messages: [] });
        const r = await q(
          `select m.*, ps.a2l_id as sender_a2l_id from messages m join profiles ps on ps.id=m.sender_id where m.conversation_id=$1 order by m.created_at asc limit 500`,
          [c.rows[0].id]
        );
        const messages = r.rows.map(m => ({ ...m, mine: m.sender_id === uid }));
        return json(res, 200, { id: c.rows[0].id, messages });
      } else {
        let cid = null;
        for (const [convId, conv] of mem.conversations) {
          if (conv.members.has(uid) && conv.members.has(to) && conv.kind === 'direct') {
            cid = convId;
            break;
          }
        }
        if (!cid) return json(res, 200, { id: null, messages: [] });
        const list = (mem.messages.get(cid) || []).map(m => ({
          ...m,
          mine: m.sender_id === uid
        }));
        return json(res, 200, { id: cid, messages: list });
      }
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('api error:', e);
    return json(res, e.status || 500, { error: e.message || 'Server error' });
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
  return true;
}

function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', d => {
      s += d;
      if (s.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function handle(c, m) {
  const type = m?.type;

  if (type === 'ping') {
    return send(c.ws, { type: 'pong' });
  }

  if (type === 'register') {
    const ctx = await authenticateWs(m.token, m.id);
    const id = ctx.a2lId;
    const old = clients.get(id);
    if (old && old !== c) {
      try {
        old.ws.close(4001, 'replaced');
      } catch {}
      await endPair(old, false);
    }
    c.id = id;
    c.authUserId = ctx.user.id;
    c.profile = m.profile || {};
    c.prefs = {};
    c.busy = false;
    c.peerId = null;
    c.public = {
      a2lId: id,
      displayName: c.profile.displayName || ctx.profile?.display_name || 'A2L user',
      avatar: c.profile.avatar || ctx.profile?.avatar_url || '🙂',
      photoData: c.profile.photoData || ctx.profile?.photo_data || '',
      ageGroup: c.profile.ageGroup || ctx.profile?.age_group || '',
      languages: c.profile.languages || ctx.profile?.languages || ['english'],
      interests: c.profile.interests || ctx.profile?.interests || [],
      location: c.profile.location || ctx.profile?.location || ''
    };
    clients.set(id, c);
    try {
      await ensureProfile(c, c.profile);
    } catch (e) {
      console.error('profile save', e.message);
    }
    send(c.ws, { type: 'registered', id, database: !!pool, auth: !ctx.user?.isGuest });
    return;
  }

  if (!c.id) return send(c.ws, { type: 'error', message: 'Register first' });

  if (type === 'profile-update') {
    c.profile = { ...c.profile, ...(m.profile || {}) };
    c.public = { ...c.public, ...(m.profile || {}), a2lId: c.id };
    try {
      await ensureProfile(c, c.profile);
    } catch (e) {
      send(c.ws, { type: 'error', message: 'Profile save failed' });
    }
    send(c.ws, { type: 'profile-saved' });
    return;
  }

  if (type === 'find-match') {
    await endPair(c, false);
    c.prefs = m.prefs || {};
    await pair(c);
    return;
  }

  if (type === 'cancel-match') {
    await endPair(c, true, 'cancelled');
    send(c.ws, { type: 'cancelled' });
    return;
  }

  // Realtime Chat Message over WebSocket
  if (type === 'chat-message') {
    const to = cleanId(m.to);
    const text = String(m.text || '').trim().slice(0, 2000);
    if (!to || !text) return;
    const target = clients.get(to);
    const msgPayload = {
      type: 'chat-message',
      from: c.id,
      fromName: c.profile?.displayName || 'A2L user',
      text,
      tempId: m.tempId,
      at: Date.now()
    };
    if (target) {
      send(target.ws, msgPayload);
    }
    send(c.ws, { type: 'chat-message-ack', tempId: m.tempId, to, at: Date.now() });
    notify(to, 'message', c.id, { text, from: c.id }).catch(() => {});
    return;
  }

  // Multiplayer Games & Group Rooms Relay
  if (['play-request', 'play-response', 'play-session-update', 'group-invite', 'group-response'].includes(type)) {
    const to = cleanId(m.to);
    const target = clients.get(to);
    if (target) {
      send(target.ws, { ...m, from: c.id, fromName: c.profile?.displayName || 'A2L user' });
    } else {
      send(c.ws, { type: 'peer-unavailable', to, action: type });
    }
    return;
  }

  if (type === 'group-update') {
    const members = m.room?.members || [];
    for (const member of members) {
      const memberA2L = cleanId(member.id || member.a2lId);
      if (memberA2L && memberA2L !== c.id) {
        const target = clients.get(memberA2L);
        if (target) send(target.ws, { ...m, from: c.id });
      }
    }
    return;
  }

  // Calls
  if (['call-invite', 'call-accept', 'call-declined', 'call-busy'].includes(type)) {
    const to = cleanId(m.to), p = clients.get(to);
    if (!p) return send(c.ws, { type: 'call-unavailable', to });

    if (type === 'call-invite') {
      const allowed = await canCall(c, p);
      if (!allowed.ok) {
        return send(c.ws, {
          type: allowed.reason === 'blocked' ? 'call-blocked' : allowed.reason === 'privacy' ? 'call-unavailable' : 'call-busy',
          to,
          from: p.id
        });
      }
      c.busy = true;
      c.peerId = p.id;
      p.busy = true;
      p.peerId = c.id;
      c.historyId = await saveHistory(c, p, 'direct');
      p.historyId = c.historyId;
    } else if (!c.peerId || c.peerId !== p.id || !p.peerId || p.peerId !== c.id) {
      return send(c.ws, { type: 'error', message: 'Call session is not active', status: 409 });
    }

    send(p.ws, {
      ...m,
      from: c.id,
      fromName: c.profile.displayName || 'A2L user',
      fromAvatar: c.profile.avatar || '🙂',
      fromPhotoData: c.profile.photoData || ''
    });

    if (type === 'call-declined' || type === 'call-busy') {
      await endPair(c, false, type === 'call-declined' ? 'declined' : 'busy');
    }
    return;
  }

  if (['offer', 'answer', 'ice', 'reaction', 'match-state'].includes(type)) {
    const p = peer(c);
    if (!p || (await isBlocked(c.id, p.id))) return send(c.ws, { type: 'call-blocked' });
    relay(c, m);
    return;
  }

  if (type === 'hangup') {
    relay(c, { type: 'hangup', reason: m.reason || 'peer-ended' });
    await endPair(c, false, m.reason || 'ended');
    return;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const body = await readBody(req);
      await api(req, res, body);
      return;
    }

    const raw = (req.url || '/').split('?')[0];
    let file = raw === '/' ? '/index.html' : raw;
    file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
    const full = path.join(ROOT, file);

    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }

    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'content-type': mime[ext] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  const c = {
    ws,
    id: null,
    authUserId: null,
    profile: {},
    prefs: {},
    busy: false,
    peerId: null,
    historyId: null,
    isAlive: true
  };

  ws.on('pong', () => {
    c.isAlive = true;
  });

  ws.on('message', raw => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'ping') {
        c.isAlive = true;
      }
      handle(c, data).catch(e => {
        send(ws, { type: 'error', message: e.message || 'Realtime error', status: e.status || 500 });
      });
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON payload' });
    }
  });

  ws.on('close', () => {
    if (c.id && clients.get(c.id) === c) {
      endPair(c, true).catch(() => {});
      clients.delete(c.id);
    }
    removeQueue(c.id);
  });

  ws.on('error', () => {});
});

// Periodic keep-alive ping and cleanup
setInterval(() => {
  for (const [id, c] of clients) {
    if (c.ws.readyState !== 1 || c.isAlive === false) {
      c.ws.terminate();
      endPair(c, false).catch(() => {});
      clients.delete(id);
      removeQueue(id);
    } else {
      c.isAlive = false;
      try {
        c.ws.ping();
      } catch {}
    }
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`Alone2Lone realtime server running on port ${PORT}; DB=${!!pool}; Auth=${REQUIRE_AUTH && !!SUPABASE_URL}`);
});
