import { readdir, readFile } from "node:fs/promises";
import https from "node:https";
import { extname, join } from "node:path";

const SUPABASE_URL = "https://arlpqgcuoprznagadnau.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_V3jf_H8m4UXNlTb50iW7jw_NUoZ0rhl";
const LOGO_DIRECTORY = new URL("./logos/", import.meta.url);
const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function normalizedStem(value, removeExtension = false) {
  const text = String(value || "");

  return String(value || "")
    .replace(removeExtension ? extname(text) : "", "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase();
}

async function supabaseRequest(path, options = {}) {
  const body = options.body == null
    ? null
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body);
  const url = new URL(`${SUPABASE_URL}${path}`);
  const headers = {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      ...options.headers
  };

  if (body) {
    headers["Content-Length"] = body.length;
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method: options.method || "GET", headers },
      response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(
              `${response.statusCode} ${response.statusMessage}: ${responseBody}`
            ));
            return;
          }

          resolve({
            text: () => responseBody,
            json: () => JSON.parse(responseBody || "null")
          });
        });
      }
    );
    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

const files = (await readdir(LOGO_DIRECTORY))
  .filter(file => SUPPORTED_EXTENSIONS.has(extname(file).toLowerCase()))
  .filter(file => !/\s+\.[^.]+$/.test(file))
  .sort();
const livesResponse = await supabaseRequest(
  "/rest/v1/lives?select=key,username"
);
const lives = await livesResponse.json();
const livesByLogoStem = new Map(
  lives
    .filter(live => live.username)
    .map(live => [normalizedStem(live.username), live])
);

for (const file of files) {
  const extension = extname(file).toLowerCase();
  const live = livesByLogoStem.get(normalizedStem(file, true));

  if (!live) {
    console.warn(`Skipped ${file}: no matching live username.`);
    continue;
  }

  const bytes = await readFile(join(LOGO_DIRECTORY.pathname, file));
  await supabaseRequest(
    `/storage/v1/object/live-logos/${encodeURIComponent(file)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": CONTENT_TYPES[extension],
        "x-upsert": "true"
      },
      body: bytes
    }
  );
  await supabaseRequest(
    `/rest/v1/lives?key=eq.${encodeURIComponent(live.key)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        logo_path: file,
        updated_at: new Date().toISOString()
      })
    }
  );
  console.log(`Uploaded and linked ${file}`);
}

console.log("Logo migration complete.");
