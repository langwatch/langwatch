// One phase of the self-hosted UX walk. Run with cwd = <checkout>/apps/ui (where @playwright/test
// resolves); argv[2] is JSON { url, email, password, shots, phase, signIn }. Writes
// <phase>-holding.png (the token console on a fresh install), <phase>-signin.png and, when signIn,
// <phase>-upgrades.png, -traces.png and -settings.png. Prints [{ page, file, url, state, error }].
import { createRequire } from "node:module";
import { join } from "node:path";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const { url, email, password, shots, phase, signIn } = JSON.parse(process.argv[2]);
const states = /Up to date|Finishing in background|Behind|Never upgraded|Upgrading|Rolled back|Needs attention|Unsupported|Access Restricted|LangWatch is upgrading/;
const results = [];
const browser = await chromium.launch();

async function capture(page, name, path, settle) {
  const file = `${phase}-${name}.png`;
  try {
    await page.goto(`${url}${path}`, { timeout: 30_000, waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    if (settle) await settle();
    await page.screenshot({ path: join(shots, file), fullPage: true });
    const text = await page.innerText("body").catch(() => "");
    results.push({ page: name, file, url: page.url(), state: text.match(states)?.[0] ?? "", error: "" });
  } catch (error) {
    results.push({ page: name, file: "", url: page.url(), state: "", error: String(error).slice(0, 300) });
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // The lab has no internet: web fonts answer empty CSS so a stalled DNS lookup never holds the page.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await capture(page, "holding", "/");
  await capture(page, "signin", "/auth/signin");
  if (signIn) {
    await page.locator('input[type="email"], input[name="email"]:not([type="hidden"])').first().fill(email);
    const field = page.locator('input[type="password"]').first();
    if (!(await field.isVisible())) await page.locator('button[type="submit"]').first().click();
    await field.fill(password, { timeout: 30_000 });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.getByRole("button", { name: "Not now" }).click({ timeout: 5_000 }).catch(() => undefined);
    const project = new URL(page.url()).pathname.split("/")[1] ?? "";
    await capture(page, "upgrades", "/ops/upgrades", () => page.getByText(states).first().waitFor({ timeout: 30_000 }).catch(() => undefined));
    await capture(page, "traces", `/${project}/messages`);
    await capture(page, "settings", "/settings");
  }
} finally {
  await browser.close();
  console.log(JSON.stringify(results));
}
