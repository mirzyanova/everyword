-- Everyword cloud storage (Supabase)
-- Run once in the linked Supabase project's SQL editor.
-- All data is private to the authenticated Supabase user.
create table if not exists public.everyword_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint everyword_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists everyword_cards_user_updated_idx
  on public.everyword_cards (user_id, updated_at desc);

alter table public.everyword_cards enable row level security;

drop policy if exists "Everyword owner can read" on public.everyword_cards;
create policy "Everyword owner can read"
  on public.everyword_cards for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Everyword owner can insert" on public.everyword_cards;
create policy "Everyword owner can insert"
  on public.everyword_cards for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Everyword owner can update" on public.everyword_cards;
create policy "Everyword owner can update"
  on public.everyword_cards for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Everyword owner can delete" on public.everyword_cards;
create policy "Everyword owner can delete"
  on public.everyword_cards for delete to authenticated
  using ((select auth.uid()) = user_id);

-- For ChatGPT to add a card, use the Supabase connector to run an INSERT
-- for the user's auth.users.id. This is a privileged server-side operation;
-- NEVER add a service-role or secret key to any public GitHub file.
