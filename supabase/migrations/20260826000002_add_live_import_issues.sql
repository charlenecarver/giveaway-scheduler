alter table public.lives
add column if not exists import_issues jsonb not null default '[]'::jsonb;
