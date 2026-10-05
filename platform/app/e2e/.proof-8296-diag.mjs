import { chromium } from "playwright";
const APP = "http://localhost:5570";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/proof-8296/auth.json", viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console", m.type(), m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 300)));
page.on("requestfailed", (r) => console.log("reqfail", r.url().slice(0, 150), r.failure()?.errorText));
page.on("response", (r) => { if (r.url().includes("lwql") || r.url().includes("chart-frame") || r.url().includes("cdn") || r.url().includes("esm")) console.log("resp", r.status(), r.url().slice(0, 150)); });
await page.goto(`${APP}/local-dev-project/analytics-v2`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(25000);
console.log("frames", page.frames().length);
for (const f of page.frames().slice(0, 3)) {
  if (f === page.mainFrame()) continue;
  const html = await f.content().catch((e) => "ERR " + e.message);
  console.log("frame url", f.url().slice(0, 80), "html", html.replace(/\s+/g, " ").slice(0, 600));
}
const badge = await page.locator("text=/could not|error|Error/i").allInnerTexts().catch(() => []);
console.log("page error texts", badge.slice(0, 5));
await page.locator('[data-testid="analytics-v2-widget-trace-count-over-time"]').screenshot({ path: "/tmp/proof-8296/diag-card.png" });
await browser.close();
