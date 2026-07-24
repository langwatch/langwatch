import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

/**
 * Captures the 5 IngestionTemplate v1 docs screenshots end-to-end against a
 * running dev stack (http://localhost:5560). Saves PNGs to
 * `~/Projects/pr-screenshots/ingestion-templates/` (the shared image-hosting
 * repo); push from there to update Mintlify references.
 *
 * Prerequisites:
 *   1. Dev stack running: `make quickstart`
 *   2. e2e/auth.json exists — run `npx tsx e2e/save-auth-state.ts` once
 *      to capture rogerio's session interactively (or any persona that has a
 *      personal project + at least one IngestionTemplate binding installed
 *      with traces visible at /me/traces).
 *   3. The persona has clicked Connect on at least claude_code so the install
 *      drawer can be re-opened to capture Surface 3 (or uninstall first to
 *      capture the empty drawer state).
 *
 * Usage:
 *   npx tsx langwatch/e2e/capture-ingestion-templates-screenshots.ts
 *
 * Output (5 files):
 *   - me-settings-personal-otlp-panel.png
 *   - me-trace-ingest-tile-grid.png
 *   - me-install-drawer-claude-code.png
 *   - me-traces-claude-code-trace-detail.png
 *   - me-traces-detail-tokens-model-cost.png
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const OUTPUT_DIR =
  process.env.OUTPUT_DIR ??
  path.resolve(
    process.env.HOME ?? "",
    "Projects/pr-screenshots/ingestion-templates",
  );
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const VIEWPORT = { width: 1440, height: 900 };

void (async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(
      `❌ auth.json missing at ${AUTH_FILE}. Run 'npx tsx e2e/save-auth-state.ts' first.`,
    );
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: VIEWPORT,
  });
  const page = await context.newPage();

  const captures: Array<{ filename: string; capture: () => Promise<void> }> = [
    {
      filename: "me-settings-personal-otlp-panel.png",
      capture: async () => {
        await page.goto(`${BASE_URL}/me/settings#otlp`);
        await page.waitForLoadState("networkidle");
        const panel = page.locator('text="Personal OTLP Endpoint"').first();
        await panel.waitFor({ state: "visible", timeout: 10_000 });
        const card = panel.locator(
          'xpath=ancestor::*[contains(@class, "css-")][1]/..',
        );
        await card.first().screenshot({
          path: path.join(OUTPUT_DIR, "me-settings-personal-otlp-panel.png"),
        });
      },
    },
    {
      filename: "me-trace-ingest-tile-grid.png",
      capture: async () => {
        await page.goto(`${BASE_URL}/me`);
        await page.waitForLoadState("networkidle");
        const heading = page.locator('text="Trace Ingest"').first();
        await heading.waitFor({ state: "visible", timeout: 10_000 });
        await heading.scrollIntoViewIfNeeded();
        const section = heading.locator(
          'xpath=ancestor::*[contains(@class, "css-")][1]/..',
        );
        await section.first().screenshot({
          path: path.join(OUTPUT_DIR, "me-trace-ingest-tile-grid.png"),
        });
      },
    },
    {
      filename: "me-install-drawer-claude-code.png",
      capture: async () => {
        await page.goto(`${BASE_URL}/me`);
        await page.waitForLoadState("networkidle");
        const tile = page.locator('[data-tile-slug="claude_code"]').first();
        await tile.waitFor({ state: "visible", timeout: 10_000 });
        await tile.click();
        // Drawer slides in
        await page.waitForSelector('text="Connect Claude Code"', {
          timeout: 5_000,
        });
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(OUTPUT_DIR, "me-install-drawer-claude-code.png"),
          clip: { x: VIEWPORT.width - 600, y: 0, width: 600, height: VIEWPORT.height },
        });
      },
    },
    {
      filename: "me-traces-claude-code-trace-detail.png",
      capture: async () => {
        await page.goto(`${BASE_URL}/me/traces?source=claude_code`);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(800);
        await page.screenshot({
          path: path.join(OUTPUT_DIR, "me-traces-claude-code-trace-detail.png"),
          fullPage: false,
        });
      },
    },
    {
      filename: "me-traces-detail-tokens-model-cost.png",
      capture: async () => {
        await page.goto(`${BASE_URL}/me/traces?source=claude_code`);
        await page.waitForLoadState("networkidle");
        const firstRow = page
          .locator(
            'a[href*="/traces/"], button:has-text("claude-code"), [role="row"]',
          )
          .first();
        if (await firstRow.count()) {
          await firstRow.click();
          await page.waitForTimeout(800);
        }
        await page.screenshot({
          path: path.join(OUTPUT_DIR, "me-traces-detail-tokens-model-cost.png"),
          fullPage: false,
        });
      },
    },
  ];

  for (const { filename, capture } of captures) {
    try {
      console.log(`Capturing ${filename}…`);
      await capture();
      console.log(`✅ ${filename}`);
    } catch (err) {
      console.error(
        `❌ ${filename} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await browser.close();
  console.log(`\nAll captures saved to ${OUTPUT_DIR}`);
})();
