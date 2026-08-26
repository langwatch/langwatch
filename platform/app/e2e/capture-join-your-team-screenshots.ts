import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";

/**
 * The join-before-create screens, captured for a pull request.
 *
 * WHAT IT CAPTURES. The offer as a whole screen, and the waiting state
 * somebody lands on after asking — the two halves of the change, and the two
 * that cannot be judged from a diff.
 *
 * IT SIGNS IN THROUGH THE PRODUCT'S OWN FORM. better-auth signs its session
 * cookie, so a hand-written one is refused, and reading the signing secret to
 * forge one would put a credential in a script. The seeded account holds a
 * password created for this run and nothing else — which is also why the
 * whole thing runs against a COPY of the development database rather than
 * against anybody's real one.
 *
 * Prerequisites:
 *   1. An app on `SHOT_BASE_URL` (default http://localhost:5560) pointed at
 *      the seeded database.
 *   2. `SHOT_PASSWORD` — the seeded account's password.
 *   3. The seed: an organization with `domainJoin = 'request'`, at least one
 *      member holding a verified identifier on the domain, and the person
 *      being screenshotted holding one too while belonging to nobody.
 *
 * Usage:
 *   SHOT_PASSWORD=… npx tsx platform/app/e2e/capture-join-your-team-screenshots.ts
 */

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:5560";
const EMAIL = process.env.SHOT_EMAIL ?? "sam@acme.test";
const PASSWORD = process.env.SHOT_PASSWORD;
const OUT = process.env.SHOT_OUT_DIR ?? "/tmp/join-screenshots";

if (!PASSWORD) {
  throw new Error("SHOT_PASSWORD is required");
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[console]", message.text());
  });

  // Signed in through the product's own form rather than by forging a cookie:
  // better-auth signs its session cookie, so a hand-written one is refused,
  // and reading the signing secret to forge one would put a credential in a
  // script. The seeded account holds a password nobody else knows.
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" });

  // Identifier-first (D13): the address is asked on its own, the router
  // decides what this person signs in WITH, and only then does a password
  // field exist. So this is two steps, and the second one has to wait for
  // the answer to the first.
  await page.getByLabel(/email/i).first().fill(EMAIL);
  await page.keyboard.press("Enter");

  const password = page.getByLabel(/password/i).first();
  await password.waitFor({ state: "visible", timeout: 30_000 });
  await password.fill(PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");

  // Somebody with no organization lands on onboarding; somebody with one
  // lands on the dashboard. The screen is mounted on both, so this follows
  // wherever sign-in put them.
  await page.waitForTimeout(2_000);

  const takeover = page.getByTestId("join-team-takeover");
  await takeover.waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, "join-offer-takeover.png") });
  console.log("captured join-offer-takeover.png");

  // Asking leads straight into the waiting half, in place.
  await page.getByRole("button", { name: /Ask to join/ }).click();
  await page.waitForTimeout(2_000);
  const waiting = page.getByTestId("join-team-waiting");
  await waiting.waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, "join-waiting-for-admin.png") });
  console.log("captured join-waiting-for-admin.png");

  await browser.close();
}

void main();
