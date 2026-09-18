import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const routes = process.env.ROUTES.split(",");
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const p0 = await ctx.newPage();
await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 90000 });
console.log("signed in ->", p0.url());
await p0.close();
for (const route of routes) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 240)));
  page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 240)));
  try {
    await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 0, null, { timeout: 60000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(2000);
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    console.log(`\n### ${route}  [${page.url().replace(APP, "")}]`);
    console.log("TEXT:", text.slice(0, 500) || "(EMPTY)");
    if (errs.length) console.log("ERRORS:", [...new Set(errs)].slice(0, 4).join(" || "));
  } catch (e) { console.log(`\n### ${route} NAV FAIL ${String(e).slice(0,200)}`); }
  await page.close();
}
await browser.close();
