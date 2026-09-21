// Renders the README images in this folder with Playwright's Chromium, at 2x.
//
//   node .github/readme/render.mjs                 # every page below
//   node .github/readme/render.mjs cover           # one page
//   node .github/readme/render.mjs cover --theme dark --bg grid --out /tmp/x.png
//
// Edit the HTML, run this, commit the HTML and the image together.
// Playwright comes from platform/app (a normal `pnpm install` at the root provides it).
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const PAGES = {
  cover: { width: 1200, height: 400, out: "cover.jpg" },
  areas: { width: 1200, height: 340, out: "areas.jpg" },
  signup: { width: 260, height: 56, out: "signup.png", transparent: true, element: ".btn" },
};

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
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
};
const names = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const selected = names.length ? names : Object.keys(PAGES);
if (opt("out") && selected.length !== 1) throw new Error("--out requires exactly one page");

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
for (const name of selected) {
  const page = PAGES[name];
  if (!page) throw new Error(`unknown page ${name}; known: ${Object.keys(PAGES).join(", ")}`);
  const out = opt("out") ?? path.join(here, page.out);
  const url = pathToFileURL(path.join(here, `${name}.html`));
  if (opt("bg")) url.searchParams.set("bg", opt("bg"));
  if (opt("theme")) url.searchParams.set("theme", opt("theme"));

  const tab = await browser.newPage({ viewport: { width: page.width, height: page.height }, deviceScaleFactor: 2 });
  await tab.goto(url.href, { waitUntil: "networkidle" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(300);
  const target = page.element ? tab.locator(page.element) : tab;
  await target.screenshot(
    out.endsWith(".png")
      ? { path: out, type: "png", omitBackground: !!page.transparent }
      : { path: out, type: "jpeg", quality: 90 },
  );
  await tab.close();
  console.log("wrote", out);
}
await browser.close();
