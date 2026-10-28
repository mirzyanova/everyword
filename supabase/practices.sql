-- Everyword V2: every completed practice is an immutable event.
-- Only the owning authenticated user can read or insert events.
create table if not exists public.everyword_practices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_day date not null,
  kind text not null check (kind in ('scheduled','free','hard')),
  completed_at timestamptz not null default now()
);
create index if not exists everyword_practices_user_day_idx
 on public.everyword_practices (user_id, local_day desc);
alter table public.everyword_practices enable row level security;
grant select, insert on public.everyword_practices to authenticated;
revoke all on public.everyword_practices from anon;
-- Policies already created in Supabase migration everyword_practice_completion_events.
-- Owner read: (select auth.uid()) = user_id
-- Owner insert: (select auth.uid()) = user_id
