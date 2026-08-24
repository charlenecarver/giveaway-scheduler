import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const cronSecret = Deno.env.get("CRON_SECRET") || "";
const appUrl = Deno.env.get("APP_URL") || "https://charlenecarver.github.io/giveaway-scheduler/";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  regular_alert_seconds: number;
  buyer_alert_seconds: number;
  favorite_alert_seconds: number;
};

type Giveaway = {
  id: string | number;
  liveName?: string;
  itemName?: string;
  endTime: number;
  doneSince?: number | null;
  isBuyerGiveaway?: boolean;
  isFavorite?: boolean;
};

function preferenceSeconds(subscription: SubscriptionRow, giveaway: Giveaway) {
  if (giveaway.isBuyerGiveaway) return subscription.buyer_alert_seconds;
  if (giveaway.isFavorite) return subscription.favorite_alert_seconds;
  return subscription.regular_alert_seconds;
}

async function processNotifications(request: Request) {
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "VAPID keys are not configured." }, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const [{ data: state, error: stateError }, { data: subscriptions, error: subscriptionsError }] =
    await Promise.all([
      supabase.from("giveaway_state").select("giveaways").eq("id", "shared").single(),
      supabase.from("push_subscriptions").select("*"),
    ]);
  if (stateError) throw stateError;
  if (subscriptionsError) throw subscriptionsError;

  const now = Date.now();
  const giveaways = (Array.isArray(state?.giveaways) ? state.giveaways : []) as Giveaway[];
  let sent = 0;

  for (const subscription of (subscriptions || []) as SubscriptionRow[]) {
    for (const giveaway of giveaways) {
      const thresholdMs = preferenceSeconds(subscription, giveaway) * 1000;
      const remainingMs = Number(giveaway.endTime) - now;
      if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > thresholdMs) continue;

      const marker = {
        endpoint: subscription.endpoint,
        giveaway_id: String(giveaway.id),
        giveaway_end_time: Number(giveaway.endTime),
      };
      const { error: markerError } = await supabase.from("push_notifications_sent").insert(marker);
      if (markerError?.code === "23505") continue;
      if (markerError) throw markerError;

      const liveName = String(giveaway.liveName || "Live giveaway");
      const itemName = String(giveaway.itemName || "Giveaway item");
      const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = String(secondsLeft % 60).padStart(2, "0");
      const notificationTitle = giveaway.isBuyerGiveaway
        ? `JOIN MEOW! 🙀 Buyer's ending in ${minutes}:${seconds}`
        : `Join meow! 🐾 Givvy ending in ${minutes}:${seconds}`;
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: notificationTitle,
          body: `${liveName} — ${itemName}`,
          tag: `giveaway-${giveaway.id}-${giveaway.endTime}`,
          url: appUrl,
        }));
        sent += 1;
      } catch (error) {
        await supabase.from("push_notifications_sent").delete().match(marker);
        const statusCode = Number((error as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        } else {
          console.error("Push delivery failed", error);
        }
      }
    }
  }
  return json({ ok: true, sent });
}

export default {
  fetch: async (request: Request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      const body = await request.json().catch(() => ({}));
      if (body.action === "process") return await processNotifications(request);
      if (body.action === "config") {
        if (!vapidPublicKey) return json({ error: "Push notifications are not configured yet." }, 503);
        return json({ publicKey: vapidPublicKey });
      }
      if (body.action === "subscribe") {
        const subscription = body.subscription;
        const preferences = body.preferences || {};
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
          return json({ error: "Invalid push subscription." }, 400);
        }
        const record = {
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          regular_alert_seconds: Number(preferences.regular_alert_seconds ?? 60),
          buyer_alert_seconds: Number(preferences.buyer_alert_seconds ?? 60),
          favorite_alert_seconds: Number(preferences.favorite_alert_seconds ?? 60),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("push_subscriptions").upsert(record, { onConflict: "endpoint" });
        if (error) throw error;
        return json({ ok: true });
      }
      if (body.action === "unsubscribe") {
        if (!body.endpoint) return json({ error: "Missing subscription endpoint." }, 400);
        const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
        if (error) throw error;
        return json({ ok: true });
      }
      return json({ error: "Unknown action." }, 400);
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
    }
  },
};
