-- ============================================================================
-- feedback-migration.sql
-- Run in the Supabase SQL editor (project lfbsratbyfgjufjpqfvi).
-- Idempotent — safe to run more than once.
--
-- Stores the two ratings asked after a "Try the game" puzzle:
--   rating    1–5  "How would you rate the game?"
--   recommend 1–5  "Would you recommend it to your friends?"
-- plus a little context about the puzzle they just played.
--
-- Written straight from the browser with the anon key (postFeedback in
-- js/social.js), so visitors do NOT need to sign in. Clients can only INSERT:
-- there is no select/update/delete policy, so ratings are readable only from
-- the dashboard (or with the service-role key).
-- ============================================================================

begin;

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  rating      int  not null check (rating between 1 and 5),
  recommend   int  not null check (recommend between 1 and 5),
  solved      boolean,
  tries       int  check (tries is null or tries between 1 and 3),
  time_ms     int  check (time_ms is null or time_ms between 0 and 3600000),
  family      text check (family is null or char_length(family) <= 40),
  difficulty  text check (difficulty is null or difficulty in ('easy', 'medium', 'hard')),
  user_id     uuid references auth.users (id) on delete set null
);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_anyone on public.feedback;
create policy feedback_insert_anyone on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

grant insert on public.feedback to anon, authenticated;

create index if not exists feedback_created_idx on public.feedback (created_at desc);

commit;

-- Handy queries for reading the results in the SQL editor:
--   select count(*), round(avg(rating), 2) as avg_rating,
--          round(avg(recommend), 2) as avg_recommend from public.feedback;
--   select * from public.feedback order by created_at desc limit 100;
