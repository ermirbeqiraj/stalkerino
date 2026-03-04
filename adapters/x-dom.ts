/**
 * x-dom adapter — scrapes X (Twitter) profile pages using pure DOM queries.
 *
 * Post IDs are extracted directly from <a href="/user/status/ID"> links in
 * the DOM, so they are always exact numeric IDs — no AI hallucination possible.
 * Post text is read from the tweet-text element in the same article node.
 */
import { type Adapter, type Item, isLoginPage } from "./base.ts";
import type { AdapterRunContext } from "./browser-manager.ts";

const xDomAdapter: Adapter = {
  id: "x-dom",

  async check(ctx: AdapterRunContext, targets: string[]): Promise<Item[]> {
    if (ctx.mode !== "chrome") {
      throw new Error("x-dom adapter requires browser: chrome");
    }
    const { page } = ctx;

    const items: Item[] = [];

    for (const target of targets) {
        const profileUrl = `https://x.com/${target}`;
        console.log(`[x-dom] Checking ${profileUrl}`);

        await page.goto(profileUrl, { waitUntil: "domcontentloaded" });

        // Wait for at least one tweet article to appear
        await page.waitForSelector("article[data-testid='tweet']", { timeout: 15000 })
          .catch(() => null);

        if (isLoginPage(page.url())) {
          throw new Error(
            `Redirected to login page — session expired for adapter x-dom (target: ${target})`
          );
        }

        // Extract post links + text directly from the DOM
        const posts = await page.evaluate((targetHandle: string) => {
          const results: Array<{ id: string; text: string; url: string }> = [];
          const seen = new Set<string>();

          const articles = document.querySelectorAll("article[data-testid='tweet']");

          for (const article of articles) {
            // Status link contains the canonical post ID
            const statusLink = article.querySelector("a[href*='/status/']") as HTMLAnchorElement | null;
            if (!statusLink) continue;

            const match = statusLink.href.match(/\/status\/(\d+)/);
            if (!match) continue;
            const postId = match[1];

            // Skip duplicates (same post can have multiple status links)
            if (seen.has(postId)) continue;
            seen.add(postId);

            // Skip pinned posts
            const articleText = (article as HTMLElement).innerText ?? "";
            if (articleText.includes("Pinned")) continue;

            // Get tweet text
            const textEl = article.querySelector("[data-testid='tweetText']") as HTMLElement | null;
            const text = textEl?.innerText?.trim() ?? "";

            // Determine the post author from the URL; skip retweets/quotes from other accounts
            const author = statusLink.href.match(/x\.com\/([^/]+)\/status/)?.[1] ?? targetHandle;
            if (author.toLowerCase() !== targetHandle.toLowerCase()) continue;

            results.push({
              id: postId,
              text,
              url: `https://x.com/${author}/status/${postId}`,
            });

            if (results.length >= 5) break;
          }

          return results;
        }, target);

        for (const post of posts) {
          items.push({
            id: `x-dom:${target}:${post.id}`,
            content: post.text,
            url: post.url,
            meta: { target },
          });
        }
      }

    return items;
  },
};

export default xDomAdapter;
