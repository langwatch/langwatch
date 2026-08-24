import { chromium } from "playwright";

const OUT = "/Users/afr/.claude/jobs/0a879c71/tmp/shots";
const base = "https://app.identity-wave2.langwatch.localhost";
const targets = [
  { name: "card-signup-light", url: "/auth/signup", scheme: "light" },
  { name: "card-signup-dark", url: "/auth/signup", scheme: "dark" },
  { name: "card-signin-light", url: "/auth/signin", scheme: "light" },
];

const browser = await chromium.launch();
for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    colorScheme: t.scheme,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page
    .goto(base + t.url, { waitUntil: "networkidle", timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  const card = page.locator("[data-auth-card]");
  await card.screenshot({ path: `${OUT}/${t.name}.png` });
  console.log(t.name, "done");
  await ctx.close();
}
await browser.close();
