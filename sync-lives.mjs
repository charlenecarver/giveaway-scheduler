import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";

const SUPABASE_URL = "https://arlpqgcuoprznagadnau.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_V3jf_H8m4UXNlTb50iW7jw_NUoZ0rhl";
const INDEX_URL = new URL("./index.html", import.meta.url);

function requestJson(path) {
  return new Promise((resolve, reject) => {
    https.get(
      `${SUPABASE_URL}${path}`,
      {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
        }
      },
      response => {
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${response.statusCode}: ${body}`));
            return;
          }
          resolve(JSON.parse(body));
        });
      }
    ).on("error", reject);
  });
}

const lives = await requestJson(
  "/rest/v1/lives?select=*&order=name.asc"
);
const localLives = lives.map(live => ({
  key: live.key,
  name: live.name,
  username: live.username,
  items: Array.isArray(live.items) ? live.items : [],
  categories: Array.isArray(live.categories) ? live.categories : [],
  logo_path: live.logo_path || "",
  import_issues: Array.isArray(live.import_issues) ? live.import_issues : [],
  last_giveaway_at: live.last_giveaway_at || null
}));
const html = await readFile(INDEX_URL, "utf8");
const replacement = `<script id="starterQuickLives" type="application/json">\n${JSON.stringify(localLives, null, 2)
  .split("\n")
  .map(line => `    ${line}`)
  .join("\n")}\n  </script>`;
const pattern = /<script id="starterQuickLives" type="application\/json">[\s\S]*?<\/script>/;

if (!pattern.test(html)) {
  throw new Error("Could not find the starterQuickLives JSON block.");
}

await writeFile(INDEX_URL, html.replace(pattern, replacement));
console.log(`Synced ${localLives.length} lives into index.html.`);
