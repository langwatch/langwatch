import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
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
for (const route of process.env.ROUTES.split(",")) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[pageerror ${route}]`, (e.stack ?? String(e)).slice(0, 1200)));
  page.on("console", (m) => { if (m.type()==="error") console.log(`[err ${route}]`, m.text().slice(0, 900)); });
  page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}]`, r.url().replace(APP, "").slice(0, 200)); });
  page.on("requestfailed", (r) => console.log(`[reqfail]`, r.url().replace(APP, "").slice(0, 200), r.failure()?.errorText));
  await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(15000);
  const t = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  console.log(`### ${route} [${page.url().replace(APP,"")}] len=${t.length} -> ${t.slice(0, 300)}`);
  await page.close();
}
await browser.close();
