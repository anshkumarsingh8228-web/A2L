-- A2L production alignment for the existing Supabase project.
-- Run through Supabase migrations. This keeps the existing UUID/auth schema intact.

begin;

-- Ensure pgcrypto extension
create extension if not exists pgcrypto;

-- 1. Profiles alignment
alter table public.profiles add column if not exists a2l_id text;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text not null default 'A2L user';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists photo_data text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists age_group text;
alter table public.profiles add column if not exists languages text[] not null default '{}';
alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists looking_for text[] not null default '{}';
alter table public.profiles add column if not exists visibility text not null default 'public';
alter table public.profiles add column if not exists privacy jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists match_prefs jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

update public.profiles set a2l_id = coalesce(a2l_id, username, 'a2l_' || replace(left(id::text, 8), '-', '')) where a2l_id is null;
create unique index if not exists profiles_a2l_id_uidx on public.profiles(a2l_id);

-- 2. Friendships table
create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a <> user_b)
);
create index if not exists friendships_user_a_idx on public.friendships(user_a);
create index if not exists friendships_user_b_idx on public.friendships(user_b);

-- 3. Friend requests table
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check (sender_id <> receiver_id)
);
create index if not exists friend_requests_receiver_status_idx on public.friend_requests(receiver_id, status);
create index if not exists friend_requests_sender_status_idx on public.friend_requests(sender_id, status);

-- 4. Chat requests table
create table if not exists public.chat_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check (sender_id <> receiver_id)
);
create index if not exists chat_requests_receiver_status_idx on public.chat_requests(receiver_id, status);
create index if not exists chat_requests_sender_status_idx on public.chat_requests(sender_id, status);

-- 5. Conversations & Conversation Members
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct',
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);

-- 6. Messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at asc);

-- 7. Connection History
create table if not exists public.connection_history (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  session_type text not null default 'random',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  reconnectable boolean not null default true,
  last_seen_at timestamptz not null default now(),
  check (user_a <> user_b)
);
create index if not exists connection_history_user_idx on public.connection_history(user_a, user_b, last_seen_at desc);
create index if not exists connection_history_user_b_idx on public.connection_history(user_b, user_a, last_seen_at desc);

-- 8. Reconnect Requests
create table if not exists public.reconnect_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  history_id uuid references public.connection_history(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create index if not exists reconnect_requests_to_status_idx on public.reconnect_requests(to_user, status);
create index if not exists reconnect_requests_from_status_idx on public.reconnect_requests(from_user, status);

-- 9. Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);

-- 10. Blocks
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocker_idx on public.blocks(blocker_id);
create index if not exists blocks_blocked_idx on public.blocks(blocked_id);

-- 11. Reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'Other',
  details text,
  created_at timestamptz not null default now()
);
create index if not exists reports_reporter_idx on public.reports(reporter_id);

-- 12. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.chat_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.connection_history enable row level security;
alter table public.reconnect_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Profiles policies
drop policy if exists "profiles readable by authenticated users" on public.profiles;
create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using (id = (select auth.uid()) or visibility = 'public');
drop policy if exists "profiles editable by owner" on public.profiles;
create policy "profiles editable by owner" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Friendships policies
drop policy if exists friendships_member_select on public.friendships;
create policy friendships_member_select on public.friendships for select to authenticated using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

-- Friend requests policies
drop policy if exists friend_requests_member_select on public.friend_requests;
create policy friend_requests_member_select on public.friend_requests for select to authenticated using (sender_id = (select auth.uid()) or receiver_id = (select auth.uid()));
drop policy if exists friend_requests_sender_insert on public.friend_requests;
create policy friend_requests_sender_insert on public.friend_requests for insert to authenticated with check (sender_id = (select auth.uid()));
drop policy if exists friend_requests_receiver_update on public.friend_requests;
create policy friend_requests_receiver_update on public.friend_requests for update to authenticated using (receiver_id = (select auth.uid())) with check (receiver_id = (select auth.uid()));

-- Chat requests policies
drop policy if exists chat_requests_member_select on public.chat_requests;
create policy chat_requests_member_select on public.chat_requests for select to authenticated using (sender_id = (select auth.uid()) or receiver_id = (select auth.uid()));
drop policy if exists chat_requests_sender_insert on public.chat_requests;
create policy chat_requests_sender_insert on public.chat_requests for insert to authenticated with check (sender_id = (select auth.uid()));
drop policy if exists chat_requests_receiver_update on public.chat_requests;
create policy chat_requests_receiver_update on public.chat_requests for update to authenticated using (receiver_id = (select auth.uid())) with check (receiver_id = (select auth.uid()));

-- Conversations & Members policies
drop policy if exists conversations_member_select on public.conversations;
create policy conversations_member_select on public.conversations for select to authenticated using (exists (select 1 from public.conversation_members cm where cm.conversation_id = id and cm.user_id = (select auth.uid())));
drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members for select to authenticated using (user_id = (select auth.uid()) or exists (select 1 from public.conversation_members cm2 where cm2.conversation_id = conversation_id and cm2.user_id = (select auth.uid())));

-- Messages policies
drop policy if exists messages_member_select on public.messages;
create policy messages_member_select on public.messages for select to authenticated using (exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid())));
drop policy if exists messages_member_insert on public.messages;
create policy messages_member_insert on public.messages for insert to authenticated with check (sender_id = (select auth.uid()) and exists (select 1 from public.conversation_members cm where cm.conversation_id = messages.conversation_id and cm.user_id = (select auth.uid())));

-- Connection History policies
drop policy if exists history_member_select on public.connection_history;
create policy history_member_select on public.connection_history for select to authenticated using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

-- Reconnect requests policies
drop policy if exists reconnect_member_select on public.reconnect_requests;
create policy reconnect_member_select on public.reconnect_requests for select to authenticated using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
drop policy if exists reconnect_sender_insert on public.reconnect_requests;
create policy reconnect_sender_insert on public.reconnect_requests for insert to authenticated with check (from_user = (select auth.uid()));
drop policy if exists reconnect_recipient_update on public.reconnect_requests;
create policy reconnect_recipient_update on public.reconnect_requests for update to authenticated using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));

-- Notifications policies
drop policy if exists notifications_owner_select on public.notifications;
create policy notifications_owner_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Blocks policies
drop policy if exists blocks_owner on public.blocks;
create policy blocks_owner on public.blocks for all to authenticated using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

-- Reports policies
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));

commit;
