import { chromium } from "playwright";
const APP = process.env.APP_BASE;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const p0 = await ctx.newPage();
for (let attempt = 1; attempt <= 8; attempt++) {
  await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await p0.locator('input[type="email"]').waitFor({ timeout: 20000 });
    break;
  } catch {
    console.log(`signin form not drawn, attempt ${attempt}`);
    await p0.waitForTimeout(8000);
  }
}
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 90000 });
await p0.close();
const page = await ctx.newPage();
page.on("response", async (r) => {
  const u = r.url().replace(APP, "");
  if (!u.includes("organization.getAll") && !u.includes("auth/session")) return;
  const body = await r.text().catch(() => "(unreadable)");
  console.log(`\n[${r.status()}] ${u.slice(0, 120)}\n  -> ${body.slice(0, 600)}`);
});
await page.goto(`${APP}/settings`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(14000);
const state = await page.evaluate(() => {
  const el = document.querySelector("#root > div");
  return { cls: el?.className, style: el ? getComputedStyle(el).minHeight + " / " + getComputedStyle(el).position : "none" };
});
console.log("\n=== spinner container ===", JSON.stringify(state));
await browser.close();
