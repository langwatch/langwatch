import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
const p0 = await ctx.newPage();
for (let a = 1; a <= 20; a++) {
  await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  try { await p0.locator('input[type="email"]').waitFor({ timeout: 15000 }); break; }
  catch { await p0.waitForTimeout(8000); }
}
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 60000 });
await p0.close();
const page = await ctx.newPage();
await page.goto(`${APP}${process.env.ROUTE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
await page.screenshot({ path: process.env.OUT, fullPage: false });
const h = await page.evaluate(() => {
  const el = document.querySelector("h1, h2");
  return el ? `${el.textContent?.slice(0,30)} :: ${getComputedStyle(el).fontFamily}` : "(no heading)";
});
console.log("heading:", h);
await browser.close();
