alter table public.lives
add column if not exists categories jsonb not null default '[]'::jsonb;
