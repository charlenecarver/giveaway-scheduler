drop trigger if exists ensure_unique_live_username on public.lives;
drop function if exists public.ensure_unique_live_username();

-- Usernames are unique regardless of capitalization or a leading @. Blank
-- usernames remain allowed for older lives that have not been identified yet.
create unique index if not exists lives_username_normalized_unique
on public.lives ((lower(regexp_replace(btrim(username), '^@+', ''))))
where lower(regexp_replace(btrim(username), '^@+', '')) <> '';
