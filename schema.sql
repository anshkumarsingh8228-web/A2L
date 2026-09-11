-- Alone2Lone production persistence schema (PostgreSQL / Supabase compatible)
create extension if not exists pgcrypto;

create table if not exists profiles (
  a2l_id text primary key,
  auth_user_id uuid unique,
  display_name text not null default 'A2L user',
  avatar text,
  photo_data text,
  bio text not null default '',
  location text,
  age_group text,
  languages jsonb not null default '[]'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  looking_for jsonb not null default '[]'::jsonb,
  visibility text not null default 'private',
  privacy jsonb not null default '{}'::jsonb,
  match_prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references profiles(a2l_id) on delete cascade,
  user_b text not null references profiles(a2l_id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_a,user_b),
  check(user_a <> user_b)
);
create index if not exists connections_user_a_idx on connections(user_a);
create index if not exists connections_user_b_idx on connections(user_b);

create table if not exists connection_requests (
  id uuid primary key default gen_random_uuid(),
  from_user text not null references profiles(a2l_id) on delete cascade,
  to_user text not null references profiles(a2l_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(from_user,to_user)
);
create index if not exists connection_requests_to_idx on connection_requests(to_user,status);

create table if not exists chat_requests (
  id uuid primary key default gen_random_uuid(),
  from_user text not null references profiles(a2l_id) on delete cascade,
  to_user text not null references profiles(a2l_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists chat_requests_to_idx on chat_requests(to_user,status);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references profiles(a2l_id) on delete cascade,
  user_b text not null references profiles(a2l_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_a,user_b),
  check(user_a <> user_b)
);
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id text not null references profiles(a2l_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);
create index if not exists messages_conversation_idx on messages(conversation_id,created_at);

create table if not exists connection_history (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references profiles(a2l_id) on delete cascade,
  user_b text not null references profiles(a2l_id) on delete cascade,
  session_type text not null default 'random',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  reconnectable boolean not null default true,
  last_seen_at timestamptz not null default now()
);
create index if not exists connection_history_user_idx on connection_history(user_a,user_b,last_seen_at desc);

create table if not exists reconnect_requests (
  id uuid primary key default gen_random_uuid(),
  from_user text not null references profiles(a2l_id) on delete cascade,
  to_user text not null references profiles(a2l_id) on delete cascade,
  history_id uuid references connection_history(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists reconnect_requests_to_idx on reconnect_requests(to_user,status);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(a2l_id) on delete cascade,
  type text not null,
  actor_id text references profiles(a2l_id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id,created_at desc);

create table if not exists blocks (
  blocker text not null references profiles(a2l_id) on delete cascade,
  blocked text not null references profiles(a2l_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker,blocked),
  check(blocker <> blocked)
);

create table if not exists likes (
  from_user text not null references profiles(a2l_id) on delete cascade,
  to_user text not null references profiles(a2l_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(from_user,to_user),
  check(from_user <> to_user)
);

create table if not exists user_settings (
  user_id text primary key references profiles(a2l_id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);


-- Authentication mapping + RLS for direct Supabase access. The Node API still performs
-- server-side authorization when using DATABASE_URL.
alter table profiles enable row level security;
alter table connections enable row level security;
alter table connection_requests enable row level security;
alter table chat_requests enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table connection_history enable row level security;
alter table reconnect_requests enable row level security;
alter table notifications enable row level security;
alter table blocks enable row level security;
alter table likes enable row level security;
alter table user_settings enable row level security;

create or replace function public.current_a2l_id() returns text
language sql stable security definer set search_path=public
as $$ select a2l_id from public.profiles where auth_user_id=auth.uid() limit 1 $$;

drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles for select using (auth_user_id=auth.uid() or visibility='public');
drop policy if exists profiles_self_insert on profiles;
create policy profiles_self_insert on profiles for insert with check (auth_user_id=auth.uid());
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update using (auth_user_id=auth.uid()) with check (auth_user_id=auth.uid());
drop policy if exists connections_member_select on connections;
create policy connections_member_select on connections for select using (user_a=public.current_a2l_id() or user_b=public.current_a2l_id());
drop policy if exists connection_requests_member on connection_requests;
create policy connection_requests_member on connection_requests for select using (from_user=public.current_a2l_id() or to_user=public.current_a2l_id());
drop policy if exists connection_requests_sender_insert on connection_requests;
create policy connection_requests_sender_insert on connection_requests for insert with check (from_user=public.current_a2l_id());
drop policy if exists connection_requests_recipient_update on connection_requests;
create policy connection_requests_recipient_update on connection_requests for update using (to_user=public.current_a2l_id()) with check (to_user=public.current_a2l_id());
drop policy if exists chat_requests_member on chat_requests;
create policy chat_requests_member on chat_requests for select using (from_user=public.current_a2l_id() or to_user=public.current_a2l_id());
drop policy if exists chat_requests_sender_insert on chat_requests;
create policy chat_requests_sender_insert on chat_requests for insert with check (from_user=public.current_a2l_id());
drop policy if exists chat_requests_recipient_update on chat_requests;
create policy chat_requests_recipient_update on chat_requests for update using (to_user=public.current_a2l_id()) with check (to_user=public.current_a2l_id());
drop policy if exists conversations_member on conversations;
create policy conversations_member on conversations for select using (user_a=public.current_a2l_id() or user_b=public.current_a2l_id());
drop policy if exists messages_member_select on messages;
create policy messages_member_select on messages for select using (exists(select 1 from conversations c where c.id=conversation_id and (c.user_a=public.current_a2l_id() or c.user_b=public.current_a2l_id())));
drop policy if exists messages_member_insert on messages;
create policy messages_member_insert on messages for insert with check (sender_id=public.current_a2l_id() and exists(select 1 from conversations c where c.id=conversation_id and (c.user_a=public.current_a2l_id() or c.user_b=public.current_a2l_id())));
drop policy if exists history_member on connection_history;
create policy history_member on connection_history for select using (user_a=public.current_a2l_id() or user_b=public.current_a2l_id());
drop policy if exists reconnect_member on reconnect_requests;
create policy reconnect_member on reconnect_requests for select using (from_user=public.current_a2l_id() or to_user=public.current_a2l_id());
drop policy if exists reconnect_sender_insert on reconnect_requests;
create policy reconnect_sender_insert on reconnect_requests for insert with check (from_user=public.current_a2l_id());
drop policy if exists reconnect_recipient_update on reconnect_requests;
create policy reconnect_recipient_update on reconnect_requests for update using (to_user=public.current_a2l_id()) with check (to_user=public.current_a2l_id());
drop policy if exists notifications_owner on notifications;
create policy notifications_owner on notifications for select using (user_id=public.current_a2l_id());
drop policy if exists notifications_owner_update on notifications;
create policy notifications_owner_update on notifications for update using (user_id=public.current_a2l_id()) with check (user_id=public.current_a2l_id());
drop policy if exists blocks_member on blocks;
create policy blocks_member on blocks for all using (blocker=public.current_a2l_id() or blocked=public.current_a2l_id()) with check (blocker=public.current_a2l_id());
drop policy if exists likes_member on likes;
create policy likes_member on likes for all using (from_user=public.current_a2l_id() or to_user=public.current_a2l_id()) with check (from_user=public.current_a2l_id());
drop policy if exists settings_owner on user_settings;
create policy settings_owner on user_settings for all using (user_id=public.current_a2l_id()) with check (user_id=public.current_a2l_id());
