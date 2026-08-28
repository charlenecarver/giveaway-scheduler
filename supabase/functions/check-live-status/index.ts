import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cronSecret = Deno.env.get("CRON_SECRET") || "";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Status = "live" | "offline" | "unknown";
type Live = {
  key: string;
  username: string;
  categories: string[] | null;
  last_giveaway_at: string | null;
};
type Check = {
  live_key: string;
  detected_status: Status;
  consecutive_live: number;
  consecutive_offline: number;
  last_checked_at: string | null;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function detectStatus(response: Response, html: string, username: string): Status {
  const text = html.toLowerCase();
  const finalPath = new URL(response.url).pathname.replace(/\/+$/, "");
  const normalizedUsername = username.replace(/^@/, "").toLowerCase();
  const redirectedToProfile = finalPath.toLowerCase() === `/@${normalizedUsername}`;
  const explicitOffline = [
    "live has ended",
    "this live has ended",
    "currently not live",
    "isn't live right now",
    "is not live right now",
  ].some(marker => text.includes(marker));

  if (!response.ok) return "unknown";

  const sigiMatch = html.match(
    /<script[^>]*id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (sigiMatch) {
    try {
      const state = JSON.parse(sigiMatch[1]);
      const liveRoom = state?.LiveRoom;
      const info = liveRoom?.liveRoomUserInfo;
      const account = info?.user;
      const accountUsername = String(account?.uniqueId || "").toLowerCase();
      const roomId = String(account?.roomId || "");

      if (
        accountUsername === normalizedUsername &&
        /^[1-9]\d+$/.test(roomId) &&
        Number(account?.status) === 2 &&
        Number(info?.liveRoom?.status) === 2
      ) {
        return "live";
      }

      if (
        liveRoom &&
        (!info || Object.keys(info).length === 0 || accountUsername === normalizedUsername)
      ) {
        return "offline";
      }
    } catch {
      return "unknown";
    }
  }

  if (explicitOffline || redirectedToProfile) return "offline";
  return "unknown";
}

async function checkTikTokLive(username: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(
      `https://www.tiktok.com/@${encodeURIComponent(username)}/live`,
      {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        },
      },
    );
    const html = await response.text();
    return { status: detectStatus(response, html, username), error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { status: "unknown" as Status, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function runChecks(request: Request) {
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const [{ data: lives, error: livesError }, { data: checks, error: checksError }, { data: state, error: stateError }] =
    await Promise.all([
      supabase.from("lives").select("key, username, categories, last_giveaway_at").neq("username", ""),
      supabase.from("live_status_checks").select("*"),
      supabase.from("giveaway_state").select("active_live_keys, live_detection_until").eq("id", "shared").single(),
    ]);
  if (livesError) throw livesError;
  if (checksError) throw checksError;
  if (stateError) throw stateError;

  const detectionUntil = Date.parse(state?.live_detection_until || "") || 0;
  if (detectionUntil <= Date.now()) {
    if (Array.isArray(state?.active_live_keys) && state.active_live_keys.length > 0) {
      const { error } = await supabase
        .from("giveaway_state")
        .update({
          active_live_keys: [],
          live_detection_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", "shared");
      if (error) throw error;
    }
    return json({ checked: 0, disabled: true });
  }

  const checkByKey = new Map((checks || []).map((check: Check) => [check.live_key, check]));
  const activeKeys = new Set<string>(Array.isArray(state?.active_live_keys) ? state.active_live_keys : []);
  const candidates = (lives || []) as Live[];
  const detectionSessionStartedAt = detectionUntil - (15 * 60 * 1000);
  const isInitialPriority = (live: Live) =>
    (live.categories || []).some(category => {
      const normalized = String(category).trim().toLowerCase();
      return normalized === "all star" || normalized.includes("faves");
    });
  const sortByOldestCheck = (left: Live, right: Live) => {
    const leftLastChecked = Date.parse(checkByKey.get(left.key)?.last_checked_at || "") || 0;
    const rightLastChecked = Date.parse(checkByKey.get(right.key)?.last_checked_at || "") || 0;
    const leftChecked = leftLastChecked >= detectionSessionStartedAt ? leftLastChecked : 0;
    const rightChecked = rightLastChecked >= detectionSessionStartedAt ? rightLastChecked : 0;
    if (leftChecked !== rightChecked) return leftChecked - rightChecked;

    // Start each detection session with favorite and All Star lives. As soon as
    // they are checked, the still-unchecked accounts move ahead of them.
    return Number(isInitialPriority(right)) - Number(isInitialPriority(left));
  };
  const activeCandidates = candidates
    .filter(live => activeKeys.has(live.key))
    .sort(sortByOldestCheck);
  const inactiveCandidates = candidates
    .filter(live => !activeKeys.has(live.key))
    .sort(sortByOldestCheck);

  const activeSlots = Math.min(15, activeCandidates.length);
  const batch = [
    ...activeCandidates.slice(0, activeSlots),
    ...inactiveCandidates.slice(0, 40 - activeSlots),
  ];
  if (batch.length < 40) {
    batch.push(...activeCandidates.slice(
      activeSlots,
      activeSlots + (40 - batch.length),
    ));
  }
  const results: Array<{ live: Live; result: { status: Status; error: string | null } }> = [];
  for (let index = 0; index < batch.length; index += 10) {
    const group = batch.slice(index, index + 10);
    results.push(...await Promise.all(group.map(async live => ({
      live,
      result: await checkTikTokLive(live.username.replace(/^@/, "")),
    }))));
  }

  let activated = 0;
  let deactivated = 0;
  const checkUpdates = [];
  for (const { live, result } of results) {
    const previous = checkByKey.get(live.key);
    const consecutiveLive = result.status === "live" ? (previous?.consecutive_live || 0) + 1 : 0;
    const consecutiveOffline = result.status === "offline" ? (previous?.consecutive_offline || 0) + 1 : 0;

    checkUpdates.push({
      live_key: live.key,
      detected_status: result.status,
      consecutive_live: consecutiveLive,
      consecutive_offline: consecutiveOffline,
      last_checked_at: new Date().toISOString(),
      last_error: result.error,
      updated_at: new Date().toISOString(),
    });

    if (consecutiveLive >= 1 && !activeKeys.has(live.key)) {
      activeKeys.add(live.key);
      activated += 1;
    } else if (consecutiveOffline >= 2 && activeKeys.has(live.key)) {
      activeKeys.delete(live.key);
      deactivated += 1;
    }
  }

  if (checkUpdates.length) {
    const { error } = await supabase
      .from("live_status_checks")
      .upsert(checkUpdates, { onConflict: "live_key" });
    if (error) throw error;
  }

  const { error: updateError } = await supabase
    .from("giveaway_state")
    .update({ active_live_keys: [...activeKeys], updated_at: new Date().toISOString() })
    .eq("id", "shared");
  if (updateError) throw updateError;

  return json({ checked: results.length, activated, deactivated });
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return await runChecks(request);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
