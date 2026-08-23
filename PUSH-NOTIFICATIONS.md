# Push notification setup

1. Run `push-notifications-setup.sql` in the Supabase SQL Editor.
2. Generate a VAPID key pair. Keep the private key secret.
3. In Supabase Edge Functions secrets, add:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (for example, `mailto:you@example.com`)
   - `CRON_SECRET` (a long random value)
   - `APP_URL` (`https://charlenecarver.github.io/`)
4. Deploy `supabase/functions/push-notifications/index.ts` as a function named
   `push-notifications` with JWT verification disabled. Browser calls still use
   the project publishable key; scheduled processing is protected by
   `CRON_SECRET`.
5. In the bottom section of `push-notifications-setup.sql`, uncomment and run
   the two `vault.create_secret` statements. Use the same `CRON_SECRET` that
   was added to the Edge Function.
6. Uncomment and run the final `cron.schedule` statement. The database checks
   every 10 seconds but calls the Edge Function only while a giveaway is
   actively running. Re-running the statement replaces the same named job.
7. Deploy the website. On iPhone, remove and re-add the site to the Home Screen
   if the installed copy predates the manifest. Open the Home Screen app, open
   Settings, and tap **Enable** under Push notifications.

Push delivery itself does not require an SMS provider. It uses the browser push
service and the existing Supabase project.
