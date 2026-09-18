import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const APP = process.env.APP_BASE;
const EMAIL = "admin@mail.langwatch.localhost";
const PASSWORD = "LocalHavenAdmin!2026";
const OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });

const src = readFileSync(process.env.ROUTE_TABLE, "utf8");
const raw = [...new Set([...src.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]))];

const PROJECT = process.env.PROJECT_SLUG ?? "local-dev-project";
const subst = {
  ":project": PROJECT,
  ":team": "local-dev-team",
  ":id": "__probe__",
  ":trace": "__probe__",
  ":span": "__probe__",
  ":openTab": "traceDetails",
  ":experiment": "__probe__",
  ":workflow": "__probe__",
  ":slug": "__probe__",
  ":runId": "__probe__",
};
const routes = raw
  .filter((p) => p !== "*" && !p.endsWith("/*") && !p.startsWith("/admin"))
  .filter((p) => !/__probe__/.test(p))
  .map((p) => p.split("/").map((seg) => (seg.startsWith(":") ? subst[seg] ?? "__probe__" : seg)).join("/"))
  // skip id-probe routes in the first pass: they 404 on data, not on code
  .filter((p) => !p.includes("__probe__"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const login = await context.newPage();
let ok = false;
for (let a = 1; a <= 40; a++) {
  try {
    await login.goto(`${APP}/auth/signin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await login.locator('input[type="email"]').waitFor({ timeout: 15000 });
    ok = true;
    break;
  } catch {
    console.error(`signin not drawn (attempt ${a}) — vite likely re-optimizing`);
    await login.waitForTimeout(10000);
  }
}
if (!ok) { console.error("gave up waiting for the signin form"); process.exit(3); }
await login.locator('input[type="email"]').fill(EMAIL);
await login.locator('input[type="password"]').fill(PASSWORD);
await login.locator('button[type="submit"]').click();
await login.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 60000 });
console.error("logged in ->", login.url());
await login.close();

const results = [];
const page = await context.newPage();
for (const route of routes) {
  const consoleErrors = [];
  const netFails = [];
  const onConsole = (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); };
  const onResp = (r) => { if (r.status() >= 400) netFails.push(`${r.status()} ${r.url().replace(APP, "").slice(0, 160)}`); };
  const onPageErr = (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 300));
  page.on("console", onConsole); page.on("response", onResp); page.on("pageerror", onPageErr);
  let bodyText = "", finalUrl = "", status = 0;
  try {
    const resp = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = resp?.status() ?? 0;
    await page
      .waitForFunction(() => (document.body?.innerText ?? "").trim().length > 0, null, {
        timeout: 25000,
        polling: 250,
      })
      .catch(() => {});
    await page.waitForTimeout(1500);
    finalUrl = page.url().replace(APP, "");
    bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    consoleErrors.push("NAV " + String(e).slice(0, 200));
  }
  page.off("console", onConsole); page.off("response", onResp); page.off("pageerror", onPageErr);
  results.push({ route, finalUrl, status, len: bodyText.length, text: bodyText.slice(0, 400), consoleErrors: [...new Set(consoleErrors)].slice(0, 6), netFails: [...new Set(netFails)].slice(0, 8) });
  console.error(`${route} -> ${finalUrl} len=${bodyText.length} err=${consoleErrors.length} net=${netFails.length}`);
}
writeFileSync(`${OUT}/sweep.json`, JSON.stringify(results, null, 2));
await browser.close();
