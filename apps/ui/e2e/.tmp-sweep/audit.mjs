import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const APP = process.env.APP_BASE;
const OUT = process.env.OUT_FILE;
const ROUTES = process.env.ROUTES.split(",").filter(Boolean);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } });
const p0 = await ctx.newPage();
await p0.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p0.locator('input[type="email"]').waitFor({ timeout: 60000 });
await p0.locator('input[type="email"]').fill("admin@mail.langwatch.localhost");
await p0.locator('input[type="password"]').fill("LocalHavenAdmin!2026");
await p0.locator('button[type="submit"]').click();
await p0.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 90000 });
console.error("signed in ->", p0.url());
await p0.close();

const results = [];
for (const route of ROUTES) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  const rpcFails = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 300)));
  page.on("response", async (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (!u.startsWith(APP)) return;
    let detail = "";
    try { detail = (await r.text()).slice(0, 300); } catch {}
    rpcFails.push({ status: r.status(), url: u.replace(APP, "").split("?")[0], q: (u.split("?")[1]||"").slice(0,120), detail });
  });
  const rec = { route, final: route, textLen: 0, text: "", errors: [], rpcFails: [], visibleErrors: [] };
  try {
    await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 0, null, { timeout: 45000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(3500);
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    rec.final = page.url().replace(APP, "");
    rec.textLen = text.length;
    rec.text = text.slice(0, 700);
    // anything that reads as a failure surface
    const vis = await page.evaluate(() => {
      const out = [];
      const pat = /(something went wrong|unknown error|failed to|could not|error|unable to|not found|went wrong|doesn't load|does not load|try again)/i;
      for (const el of document.querySelectorAll('[role="alert"],[role="status"],[data-part="root"][data-scope="toast"],[class*="chakra-alert"]')) {
        const t = (el.innerText||"").replace(/\s+/g," ").trim();
        if (t) out.push("ALERT: " + t.slice(0,200));
      }
      const body = (document.body?.innerText||"");
      for (const line of body.split("\n")) {
        const t = line.trim();
        if (t && pat.test(t) && t.length < 200) out.push("TEXT: " + t);
      }
      return [...new Set(out)].slice(0, 8);
    });
    rec.visibleErrors = vis;
  } catch (e) {
    rec.text = "NAVFAIL " + String(e).slice(0, 200);
  }
  rec.errors = [...new Set(consoleErrors)].slice(0, 6);
  rec.rpcFails = rpcFails.slice(0, 12);
  results.push(rec);
  console.error(`${route} len=${rec.textLen} err=${rec.errors.length} fail=${rec.rpcFails.length} vis=${rec.visibleErrors.length}`);
  await page.close();
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
await browser.close();
