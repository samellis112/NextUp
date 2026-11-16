# Supabase migrations

SQL files here are applied manually in the Supabase dashboard — nothing in the
app runs them.

## guest-leaderboard-migration.sql

Lets signed-out players join the daily board under a typed guest name
(`postGuestScore` in [js/social.js](../js/social.js)) and stores the try each
puzzle was solved on (`tries_grid`, shown as "1 1 2 ✕ 1"). Paste the whole file
into the SQL editor and click **Run**. Until then guest names fail to save and
the board shows "4/5" instead of the per-puzzle tries.

## feedback-migration.sql

Creates the `feedback` table for the two 1–5 ratings asked after a "Try the
game" puzzle (`postFeedback` in [js/social.js](../js/social.js)). Insert-only
for the browser, no sign-in needed; read the results in the dashboard. Paste
the whole file into the SQL editor and click **Run** — until then the "Send
feedback" button fails with "Couldn't send that".

## scores-hardening.sql

Locks down the `scores` table, which the game writes to directly from the
browser (`postScore` in [js/social.js](../js/social.js)) with the anon key.
Without it, anyone with the anon key can insert a fake 1ms score under any
`user_id`. The migration adds:

> **Latest migration:** run `attempts-migration.sql` — adds `attempts` (5–15,
> total tries across the daily's 5 puzzles) and `day_key` (YYYY-MM-DD daily
> identity used by the leaderboard), plus the speed-floor and difficulty-set
> updates. Boards rank by solved desc → attempts asc → time asc.

- **CHECK constraints** — `avg_solve_ms` must be 500–600000 ms, `accuracy`
  0–1, `difficulty` one of `easy/medium/hard/daily`, `display_name`
  1–80 chars. Added `NOT VALID` so existing bad rows don't block the
  migration; new inserts are checked immediately.
- **RLS policies** — all existing policies on `scores` are dropped and
  replaced: anyone can read, only signed-in users can insert, and only with
  `user_id = auth.uid()`. No update/delete policies, so rows are immutable
  to clients.
- **Rate limit** — a trigger rejects a 6th insert from the same user within
  one minute.

### How to apply

1. Open the [SQL editor](https://supabase.com/dashboard/project/lfbsratbyfgjufjpqfvi/sql/new)
   for project `lfbsratbyfgjufjpqfvi`.
2. Paste the entire contents of `scores-hardening.sql` and click **Run**.
   It's wrapped in a transaction, so it applies fully or not at all.
3. Clean up any already-forged rows: run the commented `SELECT` at the bottom
   of the file to see what would be deleted, then the `DELETE` if it looks
   right.
4. After cleanup, run the four commented `VALIDATE CONSTRAINT` statements
   (mid-file) so the ranges are enforced on existing data too.
5. Sanity-check in the app: sign in, finish a round, and confirm the score
   still appears on the leaderboard. A second quick test — submitting six
   rounds inside a minute — should fail the sixth insert with a rate-limit
   error in the console.

### Known limits

This stops impersonation, absurd values, and bulk spam, but a signed-in user
can still post a *plausible* fake score (e.g. 1600 ms average) by calling the
API directly — fully preventing that requires moving scoring server-side
(e.g. an Edge Function that validates round data), which is a later step.
