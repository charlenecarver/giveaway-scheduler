alter table public.lives
add column if not exists last_giveaway_at timestamptz;

update public.lives
set last_giveaway_at = updated_at
where last_giveaway_at is null;
