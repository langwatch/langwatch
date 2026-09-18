import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const MATCH = process.env.MATCH;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } });
const p0 = await ctx.newPage();
await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p0.locator('input[type="email"]').waitFor({ timeout: 60000 });
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 90000 });
await p0.close();
const page = await ctx.newPage();
page.on("response", async (r) => {
  if (!r.url().includes(MATCH)) return;
  try { const t = await r.text(); console.log("### ", r.status(), r.url().replace(APP,"").slice(0,120), "\n", t.slice(0, Number(process.env.LEN ?? 2500))); } catch {}
});
await page.goto(`${APP}${process.env.ROUTE}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(8000);
await browser.close();
