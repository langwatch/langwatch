import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const p0 = await ctx.newPage();
for (let a = 1; a <= 8; a++) {
  await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 90000 });
  try { await p0.locator('input[type="email"]').waitFor({ timeout: 20000 }); break; }
  catch { await p0.waitForTimeout(8000); }
}
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 90000 });
await p0.close();
const page = await ctx.newPage();
const calls = [];
page.on("request", (r) => { const u = r.url().replace(APP, ""); if (u.startsWith("/api/")) calls.push(u.slice(0, 110)); });
await page.goto(`${APP}/settings`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(12000);
console.log("=== api calls ===\n" + calls.join("\n"));
// If CommandBarProvider mounted, Cmd+K opens the palette: proof we are BELOW
// UiNavigationHost's departing gate and stuck inside NavigationShell instead.
console.log("=== PROBE ===");
console.log(JSON.stringify(await page.evaluate(() => window.__probe ?? "(none)"), null, 2));
await browser.close();
