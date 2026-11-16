-- ============================================================================
-- guest-leaderboard-migration.sql
-- Run in the Supabase SQL editor (project lfbsratbyfgjufjpqfvi).
-- Idempotent — safe to run more than once. Run AFTER attempts-migration.sql.
--
-- 1. tries_grid — the try each of the 5 daily puzzles was solved on, e.g.
--    '1,1,2,x,1' (x = missed). The board shows it as "1 1 2 ✕ 1".
-- 2. Guest scores — a player who isn't signed in can put a daily score on the
--    board under a name they type. Guest rows have user_id NULL and a
--    guest_id (a random id kept in that browser). One guest row per browser
--    per day; guests can only post daily scores.
-- ============================================================================

begin;

-- 1. Per-puzzle tries.
alter table public.scores add column if not exists tries_grid text;
alter table public.scores drop constraint if exists scores_tries_grid_format;
alter table public.scores
  add constraint scores_tries_grid_format
  check (tries_grid is null or tries_grid ~ '^[123x](,[123x]){4}$') not valid;

-- 2. Guests.
alter table public.scores alter column user_id drop not null;
alter table public.scores add column if not exists guest_id uuid;

alter table public.scores drop constraint if exists scores_owner_present;
alter table public.scores
  add constraint scores_owner_present
  check (user_id is not null or guest_id is not null) not valid;

-- Guest names are short.
alter table public.scores drop constraint if exists scores_guest_name_length;
alter table public.scores
  add constraint scores_guest_name_length
  check (user_id is not null or char_length(display_name) between 1 and 24) not valid;

-- One guest row per browser per day.
create unique index if not exists scores_guest_day_uniq
  on public.scores (guest_id, day_key) where guest_id is not null;

-- Signed-out visitors may insert a guest daily row (never one claiming a user).
drop policy if exists scores_insert_guest on public.scores;
create policy scores_insert_guest
  on public.scores
  for insert
  to anon, authenticated
  with check (
    user_id is null
    and guest_id is not null
    and difficulty = 'daily'
    and day_key is not null
  );
grant insert on public.scores to anon;

-- Rate limit: per signed-in user as before; guests are limited per guest_id.
create or replace function public.scores_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count integer;
begin
  if new.user_id is not null then
    select count(*) into recent_count from public.scores
    where user_id = new.user_id and created_at > now() - interval '1 minute';
  else
    select count(*) into recent_count from public.scores
    where guest_id = new.guest_id and created_at > now() - interval '1 minute';
  end if;
  if recent_count >= 5 then
    raise exception 'Too many score submissions; please wait a minute before posting again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.scores_rate_limit() from public, anon, authenticated;

commit;
