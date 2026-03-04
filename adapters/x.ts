import type { Page } from "playwright";
import { z } from "zod";
import { type Adapter, type Item, createStagehand, isLoginPage } from "./base.ts";

const PostSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string().describe("Post ID or unique URL path"),
      text: z.string().describe("Full post text content"),
      url: z.string().describe("Full URL to the post"),
      timestamp: z.string().optional().describe("Post timestamp or relative time"),
    })
  ),
});

const xAdapter: Adapter = {
  id: "x",

  async check(_page: Page, targets: string[]): Promise<Item[]> {
    const stagehand = await createStagehand("x");
    if (!stagehand) {
      throw new Error("Session not available — run: npm run login x");
    }

    const items: Item[] = [];

    try {
      for (const target of targets) {
        const profileUrl = `https://x.com/${target}`;
        console.log(`[x] Checking ${profileUrl}`);

        await stagehand.page.goto(profileUrl, { waitUntil: "domcontentloaded" });
        await stagehand.page.waitForTimeout(2500);

        const currentUrl = stagehand.page.url();
        if (isLoginPage(currentUrl)) {
          throw new Error(
            `Redirected to login page — session expired for adapter x (target: ${target})`
          );
        }

        // Check for protected or non-existent profile
        const pageText = await stagehand.page.evaluate(
          () => document.body.innerText
        );
        if (
          pageText.includes("This account doesn't exist") ||
          pageText.includes("Account suspended")
        ) {
          console.warn(`[x] Profile ${target} does not exist or is suspended`);
          continue;
        }
        if (
          pageText.includes("These posts are protected") ||
          pageText.includes("This account's posts are protected")
        ) {
          console.warn(`[x] Profile ${target} is protected`);
          continue;
        }

        const result = await stagehand.extract({
          instruction: `Extract the latest 5 posts from this X (Twitter) profile page. For each post, get the full text content, the direct URL to the post (it should look like https://x.com/${target}/status/NUMBERS), and the post ID (the numeric part at the end of the post URL). Also get the timestamp or relative time shown (e.g. "2h", "Mar 1"). Skip pinned posts if there is one.`,
          schema: PostSchema,
        });

        for (const post of result.posts ?? []) {
          if (!post.id || !post.text) continue;

          // Normalize id — extract numeric post id from URL if possible
          const idMatch = post.url?.match(/status\/(\d+)/);
          const normalizedId = idMatch ? idMatch[1] : post.id;

          items.push({
            id: `x:${target}:${normalizedId}`,
            content: post.text,
            url: post.url || `https://x.com/${target}`,
            meta: {
              target,
              timestamp: post.timestamp,
            },
          });
        }
      }
    } finally {
      await stagehand.close();
    }

    return items;
  },
};

export default xAdapter;
