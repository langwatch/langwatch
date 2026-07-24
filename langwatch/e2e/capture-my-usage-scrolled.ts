/**
 * Captures /me scrolled to the My Usage panel — closes alexis (2) gap
 * 'replace [the dropped paragraph spot] with FILLED your-usage screenshot
 *  (spend/graph this month)'.
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const OUT_DIR = "/tmp/post-bypass-my-usage";

async function shoot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
  console.log(`captured ${name}.png`);
}

void (async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`auth.json missing at ${AUTH_FILE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  // Very tall viewport so 'Spending over time' + 'By tool' + 'Recent
  // activity' all fit. /me page has 3 SectionCards stacked under My
  // Usage; previous 1400px capture cut off everything below the spend
  // chart. Bumping to 2400px ensures all 3 sections + footer fit even
  // with 4-5 model rows in the by-tool breakdown.
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1440, height: 2400 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/me`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('text=/Claude Code/i', { timeout: 30_000 }).catch(() => {});
  await page.waitForSelector('text=/Spent this month|SPENT THIS MONTH/i', { timeout: 30_000 }).catch(() => {});
  // Wait for at least one model row in the By-tool breakdown to render
  await page.waitForSelector('text=/claude-sonnet|claude-opus|claude-haiku|gpt-5|gemini/i', { timeout: 30_000 }).catch(() => {});
  // Don't strict-wait for "By tool" header — fall through if missing,
  // we'll see in the screenshot.
  await page.waitForTimeout(3000);

  // Scroll My Usage section into view
  const myUsage = page.locator('text=/My Usage/i').first();
  if ((await myUsage.count()) > 0) {
    await myUsage.scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(1500);
  await shoot(page, "37-me-usage-scrolled");

  // Force scroll to bottom for full-page capture preconditions
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await shoot(page, "37b-me-usage-fullpage", true);

  // Diagnostic: log whether By tool / Recent activity rendered
  const byToolCount = await page.locator('text=/By tool/i').count();
  const recentCount = await page.locator('text=/Recent activity/i').count();
  console.log(`[diagnostic] 'By tool' rendered: ${byToolCount > 0 ? 'YES' : 'NO'}`);
  console.log(`[diagnostic] 'Recent activity' rendered: ${recentCount > 0 ? 'YES' : 'NO'}`);

  await browser.close();
  console.log("done");
})();
