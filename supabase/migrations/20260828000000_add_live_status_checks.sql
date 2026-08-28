create table if not exists public.live_status_checks (
  live_key text primary key references public.lives(key) on delete cascade,
  detected_status text not null default 'unknown'
    check (detected_status in ('live', 'offline', 'unknown')),
  consecutive_live integer not null default 0,
  consecutive_offline integer not null default 0,
  last_checked_at timestamptz,
  last_error text,
  manual_override boolean,
  manual_override_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.live_status_checks enable row level security;

create policy "Public can read live status checks"
on public.live_status_checks for select using (true);

create policy "Public can set live status overrides"
on public.live_status_checks for insert with check (true);

create policy "Public can update live status overrides"
on public.live_status_checks for update using (true) with check (true);

grant select, insert, update on public.live_status_checks to anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_live_status_checker()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  function_cron_secret text;
begin
  select decrypted_secret into function_cron_secret
  from vault.decrypted_secrets
  where name = 'push_cron_secret';

  if function_cron_secret is null then
    raise warning 'The push_cron_secret Vault secret is required for live status checks.';
    return;
  end if;

  perform net.http_post(
    url := 'https://arlpqgcuoprznagadnau.supabase.co/functions/v1/check-live-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', function_cron_secret
    ),
    body := '{"action":"check"}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_live_status_checker() from public;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'check-tiktok-live-statuses';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'check-tiktok-live-statuses',
    '* * * * *',
    'select public.invoke_live_status_checker()'
  );
end $$;
