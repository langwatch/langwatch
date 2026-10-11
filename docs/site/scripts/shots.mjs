import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(root, "node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core"));
const out = path.join(root, ".claude/tmp/docs-site/shots");
mkdirSync(out, { recursive: true });

const base = process.env.DOCS_URL ?? "http://localhost:4173";
const pages = (process.argv[2] ?? "introduction,integration/quick-start,api-reference/traces/get-trace").split(",");
const sizes = [
  { name: "1440", width: 1440, height: 1100 },
  { name: "390", width: 390, height: 844 },
];
const modes = (process.argv[3] ?? "light,dark").split(",");
const bannerContent = JSON.parse(readFileSync(path.join(root, "docs/docs.json"), "utf8")).banner.content;
let hash = 0;
for (const char of bannerContent) hash = (hash * 31 + char.charCodeAt(0)) | 0;

const browser = await chromium.launch();
for (const slug of pages) {
  for (const size of sizes) {
    for (const mode of modes) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: mode, reducedMotion: "reduce" });
      await context.addInitScript(({ mode, hash }) => {
        localStorage.setItem("theme", mode);
        localStorage.setItem(`lw-docs:banner:${hash}`, "dismissed");
      }, { mode, hash: String(hash) });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      await page.goto(`${base}/${slug}/`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      const name = `${slug.replace(/\//g, "_")}-${size.name}-${mode}`;
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      await page.screenshot({ path: path.join(out, `${name}-full.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      console.log(name, errors.length ? `errors: ${errors.slice(0, 3).join(" | ")}` : "ok", overflow ? "HORIZONTAL OVERFLOW" : "");
      await context.close();
    }
  }
}
await browser.close();
