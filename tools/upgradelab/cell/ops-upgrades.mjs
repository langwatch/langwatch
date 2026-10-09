// One screenshot for an upgradelab cell: the holding page, or Ops > Upgrades after signing in.
// Run with cwd = <head>/apps/ui (where @playwright/test resolves); argv[2] is JSON
// { url, email, password, out, signIn }. Prints { url, text } as JSON.
import { createRequire } from "node:module";

const { chromium } = createRequire(`${process.cwd()}/package.json`)("@playwright/test");
const { url, email, password, out, signIn } = JSON.parse(process.argv[2]);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (signIn) {
    await page.goto(`${url}/auth/signin?callbackUrl=%2Fops%2Fupgrades`, { timeout: 30_000 });
    // Identifier first: the email, Continue, then the password appears.
    await page.locator('input[type="email"], input[name="email"]:not([type="hidden"])').first().fill(email);
    const passwordField = page.locator('input[type="password"]').first();
    if (!(await passwordField.isVisible())) await page.locator('button[type="submit"]').first().click();
    await passwordField.fill(password, { timeout: 30_000 });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/ops\/upgrades/, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    // The passkey nudge covers the page after a password sign-in.
    await page.getByRole("button", { name: "Not now" }).click({ timeout: 5_000 }).catch(() => undefined);
    const states = /Up to date|Finishing in background|Behind|Never upgraded|Upgrading|Rolled back|Needs attention|Unsupported|Forbidden|not allowed/;
    await page.getByText(states).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  } else {
    await page.goto(url, { timeout: 30_000 });
  }
  await page.screenshot({ path: out, fullPage: true });
  const text = await page.innerText("body").catch(() => "");
  console.log(JSON.stringify({ url: page.url(), text: text.slice(0, 4000) }));
} finally {
  await browser.close();
}
