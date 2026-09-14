-- A2L production alignment for the existing Supabase project.
-- Run through Supabase migrations. This keeps the existing UUID/auth schema intact.

begin;

alter table public.profiles add column if not exists a2l_id text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists photo_data text;
alter table public.profiles add column if not exists looking_for text[] not null default '{}';
alter table public.profiles add column if not exists visibility text not null default 'public';
alter table public.profiles add column if not exists privacy jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists match_prefs jsonb not null default '{}'::jsonb;
update public.profiles set a2l_id=coalesce(a2l_id, username, 'a2l_'||replace(left(id::text,8),'-','')) where a2l_id is null;
create unique index if not exists profiles_a2l_id_uidx on public.profiles(a2l_id);

create table if not exists public.chat_requests (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
 receiver_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(sender_id,receiver_id)
);
create index if not exists chat_requests_receiver_status_idx on public.chat_requests(receiver_id,status);
create index if not exists chat_requests_sender_status_idx on public.chat_requests(sender_id,status);

create table if not exists public.connection_history (
 id uuid primary key default gen_random_uuid(), user_a uuid not null references public.profiles(id) on delete cascade,
 user_b uuid not null references public.profiles(id) on delete cascade, session_type text not null default 'random',
 started_at timestamptz not null default now(), ended_at timestamptz, outcome text,
 reconnectable boolean not null default true, last_seen_at timestamptz not null default now(), check(user_a<>user_b)
);
create index if not exists connection_history_user_idx on public.connection_history(user_a,user_b,last_seen_at desc);
create index if not exists connection_history_user_b_idx on public.connection_history(user_b,user_a,last_seen_at desc);

create table if not exists public.reconnect_requests (
 id uuid primary key default gen_random_uuid(), from_user uuid not null references public.profiles(id) on delete cascade,
 to_user uuid not null references public.profiles(id) on delete cascade, history_id uuid references public.connection_history(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(), responded_at timestamptz, check(from_user<>to_user)
);
create index if not exists reconnect_requests_to_status_idx on public.reconnect_requests(to_user,status);
create index if not exists reconnect_requests_from_status_idx on public.reconnect_requests(from_user,status);

create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 type text not null, actor_id uuid references public.profiles(id) on delete set null,
 payload jsonb not null default '{}'::jsonb, read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);

alter table public.chat_requests enable row level security;
alter table public.connection_history enable row level security;
alter table public.reconnect_requests enable row level security;
alter table public.notifications enable row level security;

drop policy if exists chat_requests_member_select on public.chat_requests;
create policy chat_requests_member_select on public.chat_requests for select to authenticated using(sender_id=(select auth.uid()) or receiver_id=(select auth.uid()));
drop policy if exists chat_requests_sender_insert on public.chat_requests;
create policy chat_requests_sender_insert on public.chat_requests for insert to authenticated with check(sender_id=(select auth.uid()));
drop policy if exists chat_requests_receiver_update on public.chat_requests;
create policy chat_requests_receiver_update on public.chat_requests for update to authenticated using(receiver_id=(select auth.uid())) with check(receiver_id=(select auth.uid()));

drop policy if exists history_member_select on public.connection_history;
create policy history_member_select on public.connection_history for select to authenticated using(user_a=(select auth.uid()) or user_b=(select auth.uid()));

drop policy if exists reconnect_member_select on public.reconnect_requests;
create policy reconnect_member_select on public.reconnect_requests for select to authenticated using(from_user=(select auth.uid()) or to_user=(select auth.uid()));
drop policy if exists reconnect_sender_insert on public.reconnect_requests;
create policy reconnect_sender_insert on public.reconnect_requests for insert to authenticated with check(from_user=(select auth.uid()));
drop policy if exists reconnect_recipient_update on public.reconnect_requests;
create policy reconnect_recipient_update on public.reconnect_requests for update to authenticated using(to_user=(select auth.uid())) with check(to_user=(select auth.uid()));

drop policy if exists notifications_owner_select on public.notifications;
create policy notifications_owner_select on public.notifications for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

drop policy if exists "profiles readable by authenticated users" on public.profiles;
create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using(id=(select auth.uid()) or visibility='public');

commit;
