import { chromium } from "playwright";

const base = "https://app.identity-wave2.langwatch.localhost";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
const anyError = async () =>
  (await page
    .locator(
      "text=/Enter your email address|That does not look like an email address/",
    )
    .count()) > 0;
const field = page.getByPlaceholder("you@company.com");
const fresh = async () => {
  await page.goto(base + "/auth/signup", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
};

await fresh();
console.log("on load:", await anyError());

await page.mouse.click(300, 500);
await page.waitForTimeout(250);
console.log("blur of autofocus, empty:", await anyError());

await field.click();
await page.mouse.click(300, 500);
await page.waitForTimeout(250);
console.log("click-in, click-off empty:", await anyError());

await field.click();
await field.pressSequentially("ab");
console.log("mid-typing invalid:", await anyError());
await field.press("Backspace");
await field.press("Backspace");
await page.waitForTimeout(250);
console.log("typed then deleted, still focused:", await anyError());

await field.pressSequentially("ab");
await page.mouse.click(300, 500);
await page.waitForTimeout(250);
console.log("typed invalid then click-off:", await anyError());

await field.click();
await field.pressSequentially("c@d.com");
await page.waitForTimeout(250);
console.log("fixed to valid while typing (error should lift):", await anyError());

await fresh();
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.waitForTimeout(250);
console.log("submit empty:", await anyError());

await browser.close();
