import { chromium } from "playwright";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/proof-8296/auth.json", viewport: { width: 1440, height: 1800 } });
const page = await context.newPage();
await page.goto("http://localhost:5570/local-dev-project/analytics-v2", { waitUntil: "domcontentloaded" });
await page.locator('[data-testid^="analytics-v2-widget-"]').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(20000);
await page.locator('[data-testid="analytics-v2-widget-top-topics"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/proof-8296/ac8-one-widget-failing.png" });
for (const f of page.frames()) { if (f === page.mainFrame()) continue; const t = (await f.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 90); console.log("frame:", t); }
await browser.close();
