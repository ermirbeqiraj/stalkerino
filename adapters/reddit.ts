import type { Page } from "playwright";
import { z } from "zod";
import { type Adapter, type Item, createStagehand, isLoginPage } from "./base.ts";

const PostsSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string().describe("Reddit post ID (the t3_xxxxx or just xxxxx part)"),
      title: z.string().describe("Post title"),
      url: z.string().describe("Full URL to the Reddit post (permalink)"),
      author: z.string().optional().describe("Post author username"),
      score: z.string().optional().describe("Upvote score or vote count"),
    })
  ),
});

const redditAdapter: Adapter = {
  id: "reddit",

  async check(_page: Page, targets: string[]): Promise<Item[]> {
    // Reddit is publicly accessible, but we still use stagehand for extraction.
    // Session file is optional for Reddit — fall back to no-session if missing.
    const stagehand = await createStagehand("reddit").catch(() => null);

    // If no session, create a bare Stagehand without loading cookies
    let sh = stagehand;
    if (!sh) {
      const { Stagehand } = await import("@browserbasehq/stagehand");
      sh = new Stagehand({ env: "LOCAL", headless: true, verbose: 0, domSettleTimeoutMs: 3000 });
      await sh.init();
    }

    const items: Item[] = [];

    try {
      for (const target of targets) {
        // Normalise target: accept "r/javascript" or "javascript"
        const subreddit = target.startsWith("r/") ? target : `r/${target}`;
        const url = `https://www.reddit.com/${subreddit}/new`;
        console.log(`[reddit] Checking ${url}`);

        await sh.page.goto(url, { waitUntil: "domcontentloaded" });
        await sh.page.waitForTimeout(2500);

        const currentUrl = sh.page.url();
        if (isLoginPage(currentUrl)) {
          throw new Error(
            `Redirected to login for reddit adapter (target: ${target}). Run: npm run login reddit`
          );
        }

        const pageText = await sh.page.evaluate(() => document.body.innerText);
        if (
          pageText.includes("This community doesn't exist") ||
          pageText.includes("This community has been banned") ||
          pageText.includes("page not found")
        ) {
          console.warn(`[reddit] Subreddit ${target} does not exist or is banned`);
          continue;
        }

        const result = await sh.extract({
          instruction: `Extract the latest 5 posts from this Reddit subreddit page (${subreddit}). For each post get: the post ID (the short alphanumeric ID in the URL like "1abcdef"), the post title, the full permalink URL (should look like https://www.reddit.com/r/NAME/comments/ID/title/), the author username, and the vote score.`,
          schema: PostsSchema,
        });

        for (const post of result.posts ?? []) {
          if (!post.id || !post.title) continue;

          // Extract clean post ID from URL if possible
          const idMatch = post.url?.match(/comments\/([a-z0-9]+)\//i);
          const normalizedId = idMatch ? idMatch[1] : post.id;

          items.push({
            id: `reddit:${subreddit}:${normalizedId}`,
            content: post.title,
            url: post.url,
            meta: {
              target: subreddit,
              author: post.author,
              score: post.score,
            },
          });
        }
      }
    } finally {
      await sh.close();
    }

    return items;
  },
};

export default redditAdapter;
