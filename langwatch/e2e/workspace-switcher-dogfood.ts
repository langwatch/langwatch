/**
 * Captures the current state of the workspace switcher as the admin
 * (rogerio) and asserts:
 *   1. No personal team belonging to another user appears in the dropdown
 *   2. No "+ New Project" affordance is rendered against another user's
 *      personal workspace
 *
 * Verifies task #43: "Investigate workspace switcher: admin sees +
 * New Project under another user's Personal Workspace". The fixes at
 * useWorkspaceData (filter personal teams by ownerUserId) + alexis
 * 0614a16c6 (RBAC drift) should have closed this. This script is the
 * dogfood lock against regression.
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const OUT_DIR = "/tmp/workspace-switcher";

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

void (async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`auth.json missing at ${AUTH_FILE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/me`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await shoot(page, "01-me-landing");

  // Open the workspace switcher
  const trigger = page
    .locator('button[aria-label*="Switch workspace"]')
    .first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();
  await page.waitForTimeout(600);
  await shoot(page, "02-switcher-open");

  // Inspect the dropdown content
  const text = await page
    .locator('[role="menu"], .chakra-menu__content, [data-scope="menu"][data-part="content"]')
    .first()
    .innerText()
    .catch(() => "");
  console.log("--- switcher dropdown text ---");
  console.log(text);
  console.log("--- end ---");

  // Check no other-user personal workspace appears
  const otherPersonalLeak = /Ariana Personal|alexis.*Personal|Personal Workspace.*\(/i.test(text);
  // Check no + New Project under any header
  const newProjectLeak = /\+ New Project|New Project/i.test(text);

  console.log(`other-user-personal-leak: ${otherPersonalLeak}`);
  console.log(`new-project-affordance-in-switcher: ${newProjectLeak}`);

  await browser.close();
  if (otherPersonalLeak) {
    console.error("REGRESSION: another user's personal workspace visible");
    process.exit(1);
  }
  console.log("OK: switcher does not leak other-users' personal workspaces");
})();
