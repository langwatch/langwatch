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
const page = await ctx.newPage();
const order = [];
page.on("request", (r) => {
  const u = r.url().replace(APP, "");
  if (u.includes("/@fs/") || u.includes("__vite-browser-external")) order.push(u.replace(/^.*langwatch\//, "").split("?")[0]);
});
await page.goto(`${APP}${process.env.ROUTE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);
const fs = await import("node:fs");
fs.writeFileSync(process.env.DUMP, order.join("\n"));
console.log("wrote", order.length, "module requests");
await browser.close();
