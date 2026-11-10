import { readFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import {
  allSocialCards,
  SOCIAL_CARD_SIZE,
  SOCIAL_CARD_SOURCES,
  SOCIAL_CARD_WEBP,
  socialCardHtml,
  socialCardPath,
  type SocialCard,
} from "../features/discovery/compile.ts";
import { cacheRoot } from "../paths.ts";
import { writeAtomically } from "./media-cache.ts";

/** Draws a card's page to a raster image; the build's is one headless Chromium page. */
export type CardCapture = {
  capture: (html: string) => Promise<Uint8Array>;
  close: () => Promise<void>;
};

async function chromiumCapture(): Promise<CardCapture> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: SOCIAL_CARD_SIZE, deviceScaleFactor: 1 });
  await page.route("http://cards.local/fonts/*", async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    if (!SOCIAL_CARD_SOURCES.fontFaces.some((face) => face.file === file)) return route.abort();
    await route.fulfill({
      contentType: "font/woff2",
      body: await readFile(path.join(SOCIAL_CARD_SOURCES.fonts, file)),
    });
  });
  return {
    capture: async (html) => {
      await page.route("http://cards.local/", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.goto("http://cards.local/");
      await page.evaluate(() => document.fonts.ready);
      const shot = await page.screenshot({ type: "png" });
      await page.unroute("http://cards.local/");
      return shot;
    },
    close: () => browser.close(),
  };
}

/** A cache entry that still decodes as a WebP card, else null so the card is drawn again. */
async function cached({ file }: { file: string | null }) {
  if (!file) return null;
  try {
    const bytes = await readFile(file);
    const meta = await sharp(bytes).metadata();
    return meta.format === "webp" ? bytes : null;
  } catch {
    return null;
  }
}

/** Each card's WebP keyed by its output name, from the disk cache or drawn on a miss. */
export async function renderSocialCards({
  cards = allSocialCards(),
  cacheDir = path.join(cacheRoot, "docs-site/social"),
  open = chromiumCapture,
}: {
  cards?: readonly SocialCard[];
  /** Where drawn cards are kept between builds; null draws every card and keeps none. */
  cacheDir?: string | null;
  open?: () => Promise<CardCapture>;
} = {}) {
  const files = new Map<string, Uint8Array>();
  let drawer: CardCapture | undefined;
  try {
    for (const card of cards) {
      const name = socialCardPath({ card }).slice(1);
      const file = cacheDir ? path.join(cacheDir, path.basename(name)) : null;
      const hit = await cached({ file });
      if (hit) {
        files.set(name, hit);
        continue;
      }
      drawer ??= await open();
      const shot = await drawer.capture(socialCardHtml({ card }));
      const image = await sharp(shot).webp(SOCIAL_CARD_WEBP).toBuffer();
      if (file) await writeAtomically({ file, bytes: image });
      files.set(name, image);
    }
  } finally {
    await drawer?.close();
  }
  return files;
}
