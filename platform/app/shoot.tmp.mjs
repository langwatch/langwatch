import { chromium } from "playwright";

const OUT = "/Users/afr/.claude/jobs/0a879c71/tmp/shots";
const base = "https://app.identity-wave2.langwatch.localhost";
const only = process.argv[2];
const targets = [
  { name: "signup-desktop-dark", url: base + "/auth/signup", vp: { width: 1600, height: 1000 }, scheme: "dark" },
  { name: "signup-desktop-light", url: base + "/auth/signup", vp: { width: 1600, height: 1000 }, scheme: "light" },
  { name: "signin-desktop-dark", url: base + "/auth/signin", vp: { width: 1600, height: 1000 }, scheme: "dark" },
  { name: "signin-desktop-light", url: base + "/auth/signin", vp: { width: 1600, height: 1000 }, scheme: "light" },
  { name: "signup-mobile-light", url: base + "/auth/signup", vp: { width: 390, height: 844 }, scheme: "light" },
  { name: "signup-wide-dark", url: base + "/auth/signup", vp: { width: 2000, height: 1125 }, scheme: "dark" },
  { name: "signup-wide-light", url: base + "/auth/signup", vp: { width: 2000, height: 1125 }, scheme: "light" },
].filter((t) => !only || t.name.includes(only));

const browser = await chromium.launch();
for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: t.vp,
    ignoreHTTPSErrors: true,
    colorScheme: t.scheme,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });
  await page
    .goto(t.url, { waitUntil: "networkidle", timeout: 45000 })
    .catch((e) => errors.push("goto: " + e.message.slice(0, 120)));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${t.name}.png` });
  console.log(t.name, errors.length ? "CONSOLE: " + errors.slice(0, 4).join(" | ") : "clean");
  await ctx.close();
}
await browser.close();
