-- Run once in Supabase Dashboard > SQL Editor before deploying the
-- push-notifications Edge Function.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  regular_alert_seconds integer not null default 60 check (regular_alert_seconds between 0 and 5999),
  buyer_alert_seconds integer not null default 60 check (buyer_alert_seconds between 0 and 5999),
  favorite_alert_seconds integer not null default 60 check (favorite_alert_seconds between 0 and 5999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_notifications_sent (
  endpoint text not null references public.push_subscriptions(endpoint) on delete cascade,
  giveaway_id text not null,
  giveaway_end_time bigint not null,
  sent_at timestamptz not null default now(),
  primary key (endpoint, giveaway_id, giveaway_end_time)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_notifications_sent enable row level security;

-- There are intentionally no anon policies. Only the Edge Function's
-- service-role client can read or change subscriptions.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_notifications_sent from anon, authenticated;

create index if not exists push_notifications_sent_sent_at_idx
on public.push_notifications_sent (sent_at);

-- Optional cleanup for old deduplication records.
delete from public.push_notifications_sent
where sent_at < now() - interval '30 days';

-- Conditional scheduler ---------------------------------------------------
-- The database checks every 10 seconds, but it invokes the paid/metered Edge
-- Function only while at least one giveaway is still running.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_push_notifications_if_active()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  has_active_giveaway boolean;
  function_url text;
  function_cron_secret text;
begin
  select exists (
    select 1
    from public.giveaway_state as state
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(state.giveaways) = 'array' then state.giveaways
        else '[]'::jsonb
      end
    ) as giveaway
    where state.id = 'shared'
      and giveaway->>'endTime' ~ '^[0-9]+([.][0-9]+)?$'
      and (giveaway->>'endTime')::numeric > extract(epoch from clock_timestamp()) * 1000
  ) into has_active_giveaway;

  if not has_active_giveaway then
    return;
  end if;

  select decrypted_secret into function_url
  from vault.decrypted_secrets
  where name = 'push_function_url';

  select decrypted_secret into function_cron_secret
  from vault.decrypted_secrets
  where name = 'push_cron_secret';

  if function_url is null or function_cron_secret is null then
    raise warning 'Push notification Vault secrets have not been configured.';
    return;
  end if;

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', function_cron_secret
    ),
    body := '{"action":"process"}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.invoke_push_notifications_if_active() from public;

-- After deploying the function, create these two Vault secrets once. Replace
-- the second value with the same long random CRON_SECRET used by the function.
-- select vault.create_secret(
--   'https://arlpqgcuoprznagadnau.supabase.co/functions/v1/push-notifications',
--   'push_function_url'
-- );
-- select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'push_cron_secret');

-- Run this once after the Vault secrets exist. Calling cron.schedule again
-- with the same name replaces the existing job instead of creating a duplicate.
-- select cron.schedule(
--   'push-notifications-while-giveaways-active',
--   '10 seconds',
--   'select public.invoke_push_notifications_if_active()'
-- );
