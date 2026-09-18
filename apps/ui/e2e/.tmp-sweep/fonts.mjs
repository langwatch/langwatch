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
const fontReqs = [];
page.on("response", (r) => { const u = r.url(); if (/\.woff2?|fonts\.googleapis|fonts\.gstatic/.test(u)) fontReqs.push(`${r.status()} ${u.slice(0,110)}`); });
await page.goto(`${APP}/local-dev-project`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
console.log("=== font requests ===");
console.log(fontReqs.length ? [...new Set(fontReqs)].join("\n") : "(NONE)");
const out = await page.evaluate(async () => {
  await document.fonts.ready;
  const loaded = new Set();
  document.fonts.forEach((f) => { if (f.status === "loaded") loaded.add(`${f.family} ${f.weight}`); });
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: (absent)`;
    const cs = getComputedStyle(el);
    return `${sel}: font-family=${cs.fontFamily} | size=${cs.fontSize} | weight=${cs.fontWeight}`;
  };
  return {
    loaded: [...loaded],
    body: pick("body"),
    heading: pick("h1") ?? pick("h2"),
    h2: pick("h2"),
    bodyVar: getComputedStyle(document.body).getPropertyValue("--chakra-fonts-body"),
    headingVar: getComputedStyle(document.body).getPropertyValue("--chakra-fonts-heading"),
  };
});
console.log("\n=== loaded faces ===\n" + (out.loaded.join("\n") || "(none loaded)"));
console.log("\n" + out.body + "\n" + out.heading + "\n" + out.h2);
console.log("\n--chakra-fonts-body =", out.bodyVar);
console.log("--chakra-fonts-heading =", out.headingVar);
await browser.close();
