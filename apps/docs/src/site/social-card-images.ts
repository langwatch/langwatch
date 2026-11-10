import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import {
  allSocialCards,
  SOCIAL_CARD_SIZE,
  socialCardHtml,
  socialCardPath,
  type SocialCard,
} from "../features/discovery/compile.ts";
import { appRoot, cacheRoot } from "../paths.ts";

const cacheDir = path.join(cacheRoot, "docs-site/social");
const fontDir = path.join(appRoot, "src/app/fonts");

/** Each card's PNG keyed by its output name, from the disk cache or one headless Chromium page. */
export async function renderSocialCards({
  cards = allSocialCards(),
}: { cards?: readonly SocialCard[] } = {}) {
  const files = new Map<string, Uint8Array>();
  const missing: { card: SocialCard; name: string; cached: string }[] = [];
  for (const card of cards) {
    const name = socialCardPath({ card }).slice(1);
    const cached = path.join(cacheDir, path.basename(name));
    try {
      files.set(name, await readFile(cached));
    } catch {
      missing.push({ card, name, cached });
    }
  }
  if (missing.length === 0) return files;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: SOCIAL_CARD_SIZE, deviceScaleFactor: 1 });
    await page.route("http://cards.local/fonts/*", async (route) => {
      const file = path.basename(new URL(route.request().url()).pathname);
      await route.fulfill({
        contentType: "font/woff2",
        body: await readFile(path.join(fontDir, file)),
      });
    });
    await mkdir(cacheDir, { recursive: true });
    for (const { card, name, cached } of missing) {
      await page.route("http://cards.local/", (route) =>
        route.fulfill({ contentType: "text/html", body: socialCardHtml({ card }) }),
      );
      await page.goto("http://cards.local/");
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: "png" });
      await page.unroute("http://cards.local/");
      await writeFile(`${cached}.${process.pid}.partial`, png);
      await rename(`${cached}.${process.pid}.partial`, cached);
      files.set(name, png);
    }
  } finally {
    await browser.close();
  }
  return files;
}
