/**
 * Dogfood ritual for claude_code template per rchaves's directive
 * (no fixture-only sign-offs). Real /me UI flow:
 *   1. Visit /me, scroll to Trace Ingest tile grid
 *   2. Click Claude Code tile → install drawer opens
 *   3. Click Install button (mints binding via real tRPC mutation)
 *   4. Reveal token, capture it via DOM scrape (don't log to file —
 *      print to stdout for the wrapper bash to pick up)
 *   5. Capture screenshots of: list, drawer-pre-install, drawer-with-token
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const OUT_DIR = "/tmp/dogfood-claude-code";

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
  console.log(`captured ${name}.png`);
}

void (async () => {
  if (!fs.existsSync(AUTH_FILE)) { console.error(`auth.json missing`); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/me`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-tile-slug="claude_code"]', { timeout: 30_000 });
  await page.locator('[data-tile-slug="claude_code"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shoot(page, "01-me-trace-ingest");

  // Click the Claude Code tile by data-tile-slug (avoids OpenAI catalog dupe)
  const tile = page.locator('[data-tile-slug="claude_code"]').first();
  if (await tile.count() === 0) {
    console.error("[fail] no [data-tile-slug='claude_code'] tile on /me");
    await shoot(page, "fail-no-tile");
    await browser.close();
    process.exit(2);
  }
  await tile.click();
  await page.waitForSelector('text=/Connect Claude Code|Install/i', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shoot(page, "02-install-drawer-open");

  // Capture token from tRPC response body (most reliable path)
  let capturedToken: string | null = null;
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("/api/trpc/") && resp.request().method() === "POST" && resp.status() === 200) {
      const body = await resp.text().catch(() => "");
      const m = body.match(/"token":"(ik-lw-[A-Za-z0-9_]+)"/);
      if (m && m[1]) {
        capturedToken = m[1];
        console.log(`[mint] full token captured from tRPC body`);
      }
    }
  });

  // Click "Issue binding token" OR "Rotate token" — scoped to the drawer
  const installBtn = page
    .locator('div[role="dialog"]')
    .locator('button:has-text("Rotate token"), button:has-text("Issue binding token")')
    .first();
  if (await installBtn.count() === 0) {
    console.error("[fail] no Install button in drawer");
    await shoot(page, "fail-no-install-btn");
    await browser.close();
    process.exit(2);
  }
  console.log("[click] Issue binding token button");
  // Wait for the tRPC mutation response, then capture
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("ingestion") && r.request().method() === "POST",
    { timeout: 10_000 },
  ).catch(() => null);
  await installBtn.click({ force: true });
  const resp = await respPromise;
  console.log(`[mutation] response received: ${resp?.status() ?? "no-response"}`);
  await page.waitForTimeout(2000);
  await shoot(page, "03-install-drawer-after-click");

  // Capture endpoint from page (the visible field)
  const endpointSpan = page.locator('div[role="dialog"]').locator('text=/\\/api\\/otel/').first();
  if (await endpointSpan.count() > 0) {
    const endpointText = await endpointSpan.innerText();
    console.log(`ENDPOINT=${endpointText.trim()}`);
  }

  if (capturedToken) {
    console.log(`TOKEN=${capturedToken}`);
  } else {
    console.log("[fail] no token captured from tRPC response");
  }
  // Click "Show" to reveal the secret + screenshot for evidence
  const showBtn = page.locator('div[role="dialog"]').locator('button:has-text("Show")').first();
  if (await showBtn.count() > 0) {
    await showBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    await shoot(page, "04-token-revealed");
  }

  await browser.close();
  console.log("done");
})();
