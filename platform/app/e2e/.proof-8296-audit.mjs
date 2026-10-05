import { chromium } from "playwright";
import fs from "node:fs";
const APP = "http://localhost:5570";
const SLUG = "local-dev-project";
const OUT = "/tmp/proof-8296";
const IDS = ["trace-count-over-time","total-cost-over-time","tokens-over-time","latency-percentiles","satisfaction-over-time","evaluation-pass-rate","average-traces-per-thread","top-models","top-topics"];

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: `${OUT}/auth.json`, viewport: { width: 1440, height: 2400 } });
const page = await context.newPage();
const apiPaths = {};
let lwqlCount = 0;
page.on("request", (r) => {
  const u = r.url(); if (!u.includes("/api/")) return;
  const p = new URL(u).pathname.replace(/\?.*$/, "");
  apiPaths[p] = (apiPaths[p] ?? 0) + 1;
  if (p.includes("analytics.lwql.query")) lwqlCount += (p.match(/analytics\.lwql\.query/g)||[]).length;
});

async function readWidgets(label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    let loading = 0;
    for (const f of page.frames()) { if (f===page.mainFrame()) continue;
      const t = await f.locator("body").innerText().catch(()=> ""); if (/Loading…/.test(t)) loading++; }
    if (loading===0) break; await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  const out = {};
  for (const id of IDS) {
    const card = page.locator(`[data-testid="analytics-v2-widget-${id}"]`);
    const cnt = await card.count();
    let txt = "";
    // find iframe within card
    for (const f of page.frames()) {
      if (f===page.mainFrame()) continue;
      try {
        const fe = await f.frameElement();
        const inCard = await fe.evaluate((el, sel) => !!el.closest(sel), `[data-testid="analytics-v2-widget-${id}"]`).catch(()=>false);
        if (inCard) { txt = (await f.locator("body").innerText().catch(()=> "")).replace(/\s+/g," ").trim(); break; }
      } catch {}
    }
    out[id] = { cardPresent: cnt>0, text: txt.slice(0,140) };
  }
  console.log(`\n===== ${label} (cards found for ${Object.values(out).filter(o=>o.cardPresent).length}/9) =====`);
  for (const id of IDS) console.log(`  ${id}: present=${out[id].cardPresent} | ${out[id].text}`);
  return out;
}

// AC1 / AC3 / AC11 default 30d
await page.goto(`${APP}/${SLUG}/analytics-v2`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60000 });
const w30 = await readWidgets("AC1 default 30d");
await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/audit-ac1-top.png` });
await page.screenshot({ path: `${OUT}/audit-ac1-full.png`, fullPage: true });
const lwqlAfter30 = lwqlCount;
console.log("lwql query count after 30d load:", lwqlAfter30);

// AC2 change period to 7d, count NEW lwql requests
lwqlCount = 0;
await page.goto(`${APP}/${SLUG}/analytics-v2?period=7d`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60000 });
const w7 = await readWidgets("AC2 period=7d");
await page.screenshot({ path: `${OUT}/audit-ac2-7d.png`, fullPage: true });
console.log("lwql query count on 7d re-query:", lwqlCount);

// AC4 empty period
await page.goto(`${APP}/${SLUG}/analytics-v2?startDate=2025-01-01T00:00:00.000Z&endDate=2025-01-08T00:00:00.000Z`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60000 });
const we = await readWidgets("AC4 empty period 2025-01-01..08");
await page.screenshot({ path: `${OUT}/audit-ac4-empty.png`, fullPage: true });

fs.writeFileSync(`${OUT}/audit-apipaths.json`, JSON.stringify(apiPaths, null, 2));
console.log("\n===== AC11 all /api paths =====");
console.log(JSON.stringify(apiPaths, null, 2));
await browser.close();
