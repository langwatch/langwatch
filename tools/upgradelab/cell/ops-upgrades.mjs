// One screenshot for an upgradelab cell: the holding page, or Ops > Upgrades after signing in.
// Run with cwd = <head>/apps/ui (where @playwright/test resolves); argv[2] is JSON
// { url, email, password, out, signIn, path?, open?, expect? }: path defaults to /ops/upgrades;
// open is text to click there (a row), expect the text to wait for after it. Prints { url, text }.
import { createRequire } from "node:module";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const {
  url,
  email,
  password,
  out,
  signIn,
  path = "/ops/upgrades",
  open,
  expect,
} = JSON.parse(process.argv[2]);
const browser = await chromium.launch({
  args: ["--disable-gpu", "--disable-accelerated-2d-canvas", "--disable-webgl"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // The lab has no internet: web fonts answer empty CSS so a stalled DNS lookup never holds
  // the page.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  if (signIn) {
    await page.goto(`${url}/auth/signin?callbackUrl=${encodeURIComponent(path)}`, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    // The boot screen covers the form until the app draws; a busy worker host can take a minute.
    await page
      .waitForSelector("#lw-boot", { state: "detached", timeout: 60_000 })
      .catch(() => undefined);
    // Identifier first: the email, Continue, then the password appears.
    await page
      .locator('input[type="email"], input[name="email"]:not([type="hidden"])')
      .first()
      .fill(email, { timeout: 60_000 });
    const passwordField = page.locator('input[type="password"]').first();
    if (!(await passwordField.isVisible()))
      await page.locator('button[type="submit"]').first().click();
    await passwordField.fill(password, { timeout: 30_000 });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((at) => at.pathname === path, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    // The passkey nudge covers the page after a password sign-in.
    await page
      .getByRole("button", { name: "Not now" })
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    if (open) {
      // A tab by its role first: a text match can land on hidden text before the tabs render.
      const tab = page.getByRole("tab", { name: open });
      await tab
        .first()
        .click({ timeout: 30_000 })
        .catch(() => page.getByText(open).first().click({ timeout: 10_000 }))
        .catch(() => undefined);
      await page
        .getByText(expect ?? open)
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    }
    const states =
      /Up to date|Finishing in background|Behind|Never upgraded|Upgrading|Rolled back|Needs attention|Unsupported|Forbidden|not allowed/;
    await page
      .getByText(states)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
  } else {
    await page.goto(url, { timeout: 30_000, waitUntil: "domcontentloaded" });
    // `load` fires before the SPA's async boot paints #root: wait for text, or the shot is blank.
    await page
      .waitForFunction(() => document.body.innerText.trim() !== "", null, { timeout: 30_000 })
      .catch(() => undefined);
  }
  // A busy host can hold the fonts back; the shot is evidence, not the verdict.
  await page.screenshot({ path: out, fullPage: true, timeout: 60_000 }).catch(() => undefined);
  const text = await page.innerText("body").catch(() => "");
  const selectedTab = await page
    .locator('[role="tab"][aria-selected="true"]')
    .first()
    .innerText({ timeout: 2_000 })
    .catch(() => "");
  console.log(JSON.stringify({ url: page.url(), text: text.slice(0, 4000), selectedTab }));
} finally {
  await browser.close();
}
