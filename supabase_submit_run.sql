-- Vocab Survivor: one ranking row per run, updated in place.
-- Run this once in the Supabase dashboard (SQL Editor), before deploying the matching vocab_survivor.html.

-- 1) identify each run so repeated sends update the same row (existing rows keep run_id = null)
alter table public.scores add column if not exists run_id uuid;
create unique index if not exists scores_run_id_key on public.scores (run_id);

-- 2) insert-or-update by run_id.
-- A single unnamed text parameter lets PostgREST accept a text/plain body, which is what
-- navigator.sendBeacon can send cross-origin (it cannot send application/json or custom headers).
create or replace function public.submit_run(text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb := $1::jsonb;
begin
  if (p->>'run_id') is null or (p->>'pack_id') is null then
    raise exception 'run_id and pack_id are required';
  end if;
  if char_length(coalesce(p->>'name', '')) not between 1 and 12 then
    raise exception 'name must be 1-12 characters';
  end if;
  if (p->>'survival_time')::numeric < 0 or (p->>'level')::int < 1 then
    raise exception 'invalid score';
  end if;

  insert into public.scores (run_id, pack_id, name, survival_time, level, accuracy)
  values (
    (p->>'run_id')::uuid,
    p->>'pack_id',
    p->>'name',
    (p->>'survival_time')::numeric,
    (p->>'level')::int,
    (p->>'accuracy')::numeric
  )
  on conflict (run_id) do update set
    name = excluded.name,
    survival_time = excluded.survival_time,
    level = excluded.level,
    accuracy = excluded.accuracy
  -- a late or out-of-order send never lowers a run's record, and a run can't move to another pack
  where excluded.survival_time >= scores.survival_time
    and excluded.pack_id = scores.pack_id;
end;
$$;

revoke all on function public.submit_run(text) from public;
grant execute on function public.submit_run(text) to anon, authenticated;

-- make the new function visible to the REST API right away
notify pgrst, 'reload schema';
