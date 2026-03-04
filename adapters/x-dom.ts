import { type Adapter, type Item, isLoginPage } from "./base.ts";
import type { AdapterRunContext } from "./browser-manager.ts";

const SNOWFLAKE_EPOCH = 1288834974657n;
const MAX_POST_AGE_MS = 24 * 60 * 60 * 1000;

function snowflakeToMs(id: string): number {
  return Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH);
}

const xDomAdapter: Adapter = {
  id: "x-dom",

  async check(ctx: AdapterRunContext, targets: string[]): Promise<Item[]> {
    if (ctx.mode !== "chrome") {
      throw new Error("x-dom adapter requires browser: chrome");
    }
    const { context } = ctx;

    const items: Item[] = [];

    for (const target of targets) {
        const profileUrl = `https://x.com/${target}`;
        console.log(`[x-dom] Checking ${profileUrl}`);

        const page = await context.newPage();
        try {

        await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle").catch(() => null);

        await page.waitForSelector("article[data-testid='tweet']", { timeout: 15000 })
          .catch(() => null);

        if (isLoginPage(page.url())) {
          throw new Error(
            `Redirected to login page — session expired for adapter x-dom (target: ${target})`
          );
        }

        const posts = await page.evaluate(() => {
          const results: Array<{ id: string; text: string; url: string }> = [];
          const seen = new Set<string>();

          const articles = document.querySelectorAll("article[data-testid='tweet']");

          for (const article of articles) {
            const timeEl = article.querySelector("time");
            const anchor = timeEl?.closest("a") as HTMLAnchorElement | null;
            if (!anchor) continue;

            const match = anchor.href.match(/\/([^/]+)\/status\/(\d+)/);
            if (!match) continue;

            const postId = match[2];

            if (seen.has(postId)) continue;
            seen.add(postId);

            const textEl = article.querySelector("[data-testid='tweetText']") as HTMLElement | null;
            const text = textEl?.innerText?.trim() ?? "";

            results.push({ id: postId, text, url: anchor.href });

            if (results.length >= 10) break;
          }

          return results;
        });

        console.log(`[x-dom] Found ${posts.length} post(s) on @${target}`);
        for (const post of posts) {
          const ageMs = Date.now() - snowflakeToMs(post.id);
          const ageStr = ageMs < 3600000
            ? `${Math.round(ageMs / 60000)}m`
            : `${(ageMs / 3600000).toFixed(1)}h`;
          if (ageMs > MAX_POST_AGE_MS) {
            console.log(`[x-dom]   SKIP  ${post.id} (${ageStr} old) — ${post.text.slice(0, 60).replace(/\n/g, " ")}`);
            continue;
          }
          console.log(`[x-dom]   KEEP  ${post.id} (${ageStr} old) — ${post.text.slice(0, 60).replace(/\n/g, " ")}`);
          items.push({
            id: `x-dom:${target}:${post.id}`,
            content: post.text,
            url: post.url,
            meta: { target },
          });
        }

        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes("session") || msg.toLowerCase().includes("login")) {
            throw err;
          }
          console.error(`[x-dom] Error on @${target}: ${msg}`);
        } finally {
          await page.close().catch(() => {});
        }
      }

    return items;
  },
};

export default xDomAdapter;
