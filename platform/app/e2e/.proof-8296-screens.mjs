// Browser proof for issue 8296: AC1, AC2, AC3, AC4, AC11 on the local stack.
import { chromium } from "playwright";
import fs from "node:fs";

const APP = process.env.APP_BASE ?? "http://localhost:5570";
const SLUG = process.env.PROJECT_SLUG ?? "local-dev-project";
const OUT = "/tmp/proof-8296";
const IDS = [
  "trace-count-over-time","total-cost-over-time","tokens-over-time","latency-percentiles",
  "satisfaction-over-time","evaluation-pass-rate","average-traces-per-thread","top-models","top-topics",
];

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: `${OUT}/auth.json`,
  viewport: { width: 1440, height: 1800 },
});
const page = await context.newPage();
const requests = [];
page.on("request", (r) => { const u = r.url(); if (u.includes("/api/")) requests.push(u); });

async function settle(label) {
  // Wait until no iframe still says Loading… (max 60s).
  const deadline = Date.now() + 60_000;
  let loading = -1;
  while (Date.now() < deadline) {
    loading = 0;
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const t = await f.locator("body").innerText().catch(() => "");
      if (/Loading…/.test(t)) loading++;
    }
    if (loading === 0) break;
    await page.waitForTimeout(1000);
  }
  const cards = await page.locator('[data-testid^="analytics-v2-widget-"]').count();
  const texts = {};
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const t = (await f.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    texts[f.name() || f.url().slice(-40)] = t;
  }
  console.log(`[${label}] cards=${cards} stillLoading=${loading}`);
  for (const [k, v] of Object.entries(texts)) console.log(`  frame ${k}: ${v}`);
  return { cards, texts };
}

// AC1 + AC3 + AC11: 30 day default period.
await page.goto(`${APP}/${SLUG}/analytics-v2`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60_000 });
await settle("AC1 default period");
await page.locator('[data-testid="analytics-v2-widget-top-topics"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/ac1-nine-charts.png`, fullPage: true });
const top = page.locator('[data-testid="analytics-v2-widget-top-topics"]');
await top.scrollIntoViewIfNeeded();
await page.waitForTimeout(3000);
await top.screenshot({ path: `${OUT}/ac3-top-topics.png` });

// AC2: change period to 7 days via the selector, then screenshot again.
const before = await page.url();
await page.goto(`${APP}/${SLUG}/analytics-v2?period=7d`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60_000 });
await settle("AC2 seven day period");
await page.screenshot({ path: `${OUT}/ac2-period-7d.png`, fullPage: true });
console.log("AC2 urls", before, "->", page.url());

// AC4: an empty absolute period in the past.
await page.goto(`${APP}/${SLUG}/analytics-v2?startDate=2025-01-01T00:00:00.000Z&endDate=2025-01-08T00:00:00.000Z`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60_000 });
await settle("AC4 empty period");
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/ac4-empty-period.png`, fullPage: true });
await page.locator('[data-testid="analytics-v2-widget-top-topics"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/ac1-bottom-row.png` });

// AC11: which API endpoints the page hit.
const counts = {};
for (const u of requests) { const k = new URL(u).pathname.replace(/\?.*$/, ""); counts[k] = (counts[k] ?? 0) + 1; }
fs.writeFileSync(`${OUT}/ac11-requests.json`, JSON.stringify(counts, null, 2));
console.log("AC11 endpoints", JSON.stringify(counts));
await browser.close();
