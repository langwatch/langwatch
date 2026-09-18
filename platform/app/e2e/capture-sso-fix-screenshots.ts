/**
 * Re-shoots the single sign-on surfaces the defect fixes touch, against a
 * running stack, so the evidence in a pull request can be reproduced rather
 * than taken on trust.
 *
 * THE OUTPUT IS GITIGNORED AND MUST STAY THAT WAY. It writes under
 * `.pr-screenshots/`, which `**\/.pr-screenshots/` ignores, because
 * `specs/ci/no-committed-screenshots.feature` fails the build for a PNG that
 * reaches the index. Publish by uploading to the `pr-screenshots` repository
 * and referencing the raw URLs; never by committing the files.
 *
 * Usage, with the addresses and the sign-in supplied by the environment:
 *
 *   BASE_URL=https://app.<slug>.langwatch.localhost:1355 \
 *   LW_EMAIL=... LW_PASSWORD=... \
 *   npx tsx e2e/capture-sso-fix-screenshots.ts
 *
 * No credential is defaulted here. A password written into a committed file
 * is a password that outlives the stack it was for, and this one would have
 * been the local administrator's.
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL;
const EMAIL = process.env.LW_EMAIL;
const PASSWORD = process.env.LW_PASSWORD;
const OUT = path.resolve(__dirname, "../.pr-screenshots/sso-fixes");
const VIEWPORT = { width: 1440, height: 900 };

if (!BASE || !EMAIL || !PASSWORD) {
  console.error(
    "Set BASE_URL, LW_EMAIL and LW_PASSWORD. `haven status --agent` prints the stack's address.",
  );
  process.exit(1);
}

/** Each shot names the defect it is evidence for, so the PR body can cite it. */
const SHOTS: { file: string; url: string; why: string }[] = [
  {
    file: "01-front-door-local-door",
    url: "/auth/signin?local=1",
    why: "4e: the break-glass door, reachable only at ?local=1",
  },
  {
    file: "02-landing-after-signin",
    url: "/",
    why: "3: a resolved session lands somewhere real, not create-your-organization",
  },
  {
    file: "03-settings-authentication",
    url: "/settings/authentication",
    why: "7: the Identity provider page renders at all (was a 500)",
  },
  {
    file: "04-authentication-connectors",
    url: "/settings/authentication/connectors",
    why: "copy: Connectors no longer promises a turn-off control that does not exist",
  },
  {
    file: "05-authentication-provider",
    url: "/settings/authentication/provider",
    why: "7: the Identity provider page, which embeds the migration view that used to 500",
  },
];

async function shoot(page: Page, file: string, url: string): Promise<string> {
  await page.goto(`${BASE}${url}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  // A ROUTE THAT DOES NOT EXIST IS NOT EVIDENCE. The 5xx listener below says
  // nothing about a 404, so a mistyped path used to photograph the not-found
  // page and pass the run as clean. Every shot now has to find its screen.
  const notFound = await page
    .getByText("You've wandered out of the simulation")
    .isVisible()
    .catch(() => false);
  if (notFound) throw new Error(`404 — no such route: ${url}`);
  // The settings screens resolve several queries before they settle; a network
  // idle wait is what the earlier run used and it is what keeps a half-drawn
  // card out of the evidence.
  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => undefined);
  const target = path.join(OUT, `${file}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return `${page.url()}`;
}

void (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });

  // Sign in through the local password door. SSO is live on this stack, so the
  // bare front door hands every visitor to the provider.
  await page.goto(`${BASE}/auth/signin?local=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.screenshot({ path: path.join(OUT, "00-door-before.png") });

  try {
    await page.getByLabel(/email/i).first().fill(EMAIL, { timeout: 10_000 });
    const next = page.getByRole("button", { name: /continue|next/i }).first();
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    }
    await page
      .getByLabel(/password/i)
      .first()
      .fill(PASSWORD, { timeout: 10_000 });
    await page
      .getByRole("button", { name: /sign in|log in|continue/i })
      .first()
      .click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), {
      timeout: 30_000,
    });
    console.log(`signed in, landed on ${page.url()}`);
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, "00-door-failed.png") });
    console.error(`sign-in failed: ${String(error)}`);
    console.error(`still at ${page.url()}`);
  }

  for (const shot of SHOTS) {
    try {
      const landed = await shoot(page, shot.file, shot.url);
      console.log(`${shot.file}  <- ${shot.url}  (landed ${landed})`);
    } catch (error) {
      console.error(`${shot.file} FAILED: ${String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nserver errors seen during capture:`);
    for (const f of new Set(failures)) console.error(`  ${f}`);
  } else {
    console.log("\nno 5xx responses during capture");
  }

  await browser.close();
  console.log(`\nwrote to ${OUT}`);
})();
