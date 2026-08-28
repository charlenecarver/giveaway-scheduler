alter table public.giveaway_state
add column if not exists live_detection_until timestamptz;
