alter table public.lives
add column if not exists created_at timestamptz;

alter table public.lives
alter column created_at set default now();
