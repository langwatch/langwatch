// Renders cover.html to cover.jpg (2400x800) with Playwright's Chromium.
//
//   node .github/readme/render.mjs                        # cream copy over backdrop.jpg
//   node .github/readme/render.mjs --theme dark --bg grid # dark palette over the card grid
//   node .github/readme/render.mjs --out /tmp/x.png
//
// Edit the headline, description or area pills in cover.html, run this, commit both.
// Playwright comes from platform/app (a normal `pnpm install` at the root provides it).
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

function loadPlaywright() {
  const candidates = [path.join(root, "platform/app/package.json")];
  const store = path.join(root, "node_modules/.pnpm");
  try {
    for (const dir of readdirSync(store)) {
      if (dir.startsWith("playwright@")) candidates.push(path.join(store, dir, "node_modules/playwright/package.json"));
    }
  } catch {}
  for (const from of candidates) {
    try {
      return createRequire(from)("playwright");
    } catch {}
  }
  throw new Error("playwright is not installed; run pnpm install at the repo root");
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const out = opt("out") ?? path.join(here, "cover.jpg");
const url = pathToFileURL(path.join(here, "cover.html"));
if (opt("bg")) url.searchParams.set("bg", opt("bg"));
if (opt("theme")) url.searchParams.set("theme", opt("theme"));

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
await page.goto(url.href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot(out.endsWith(".png") ? { path: out, type: "png" } : { path: out, type: "jpeg", quality: 90 });
await browser.close();
console.log("wrote", out);
