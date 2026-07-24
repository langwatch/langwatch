/**
 * admin-ottl-dogfood.ts — Ask A real-user QA for IngestionTemplates
 * authoring flow at /settings/governance/tool-catalog → Ingestion
 * Templates tab. Drives the 4 paths shipped at d61842a3f:
 *
 *   1. List view shows platform rows + org-authored rows
 *   2. View OTTL on platform row → read-only drawer with ottlRules
 *   3. Clone to customise on platform row → org-authored row created,
 *      Edit drawer opens
 *   4. Edit OTTL on org row → save → row updated
 *   5. Archive on org row → row disappears
 *
 * Outputs PNGs to /tmp/ottl-dogfood/ + a JSON report (pass/fail per path).
 *
 * Prereqs:
 *   - Dev stack running, e2e/auth.json valid (rogerio with org:manage)
 *   - At least one Platform IngestionTemplate seeded (claude_code etc.)
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const OUT_DIR = "/tmp/ottl-dogfood";
const VIEWPORT = { width: 1440, height: 900 };

type StepResult = { name: string; ok: boolean; note?: string };

async function shoot(page: Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function step(
  results: StepResult[],
  name: string,
  fn: () => Promise<void>,
) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, note });
    console.error(`  ❌ ${name} — ${note}`);
  }
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
    viewport: VIEWPORT,
  });
  const page = await context.newPage();
  const results: StepResult[] = [];

  await step(results, "navigate-to-tool-catalog", async () => {
    await page.goto(`${BASE_URL}/settings/governance/tool-catalog`);
    await page.waitForLoadState("networkidle");
    await page
      .locator('text="AI Tool Catalog"')
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    await shoot(page, "01-tool-catalog-landing");
  });

  await step(results, "click-ingestion-templates-tab", async () => {
    await page.locator('button:has-text("Ingestion Templates")').first().click();
    // Wait for the table to render with at least one row, OR the empty state.
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Platform") ||
        document.body.innerText.includes("No ingestion templates"),
      undefined,
      { timeout: 10_000 },
    );
    await shoot(page, "02-ingestion-templates-tab");
  });

  await step(results, "view-platform-ottl-readonly", async () => {
    const viewBtn = page.locator('button:has-text("View")').first();
    await viewBtn.waitFor({ state: "visible", timeout: 5_000 });
    await viewBtn.click();
    await page
      .locator('text=/clone the row.*to customise/i')
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    await shoot(page, "03-platform-view-ottl-readonly");
    // Close drawer via backdrop click + wait until positioner gone
    await page.locator('[data-part="backdrop"]').first().click({ force: true });
    await page
      .locator('[data-part="positioner"]')
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 });
  });

  await step(results, "clone-platform-row", async () => {
    const cloneBtn = page
      .locator('button:has-text("Clone to customise")')
      .first();
    await cloneBtn.waitFor({ state: "visible", timeout: 5_000 });
    await cloneBtn.click();
    // Edit drawer opens after the mutation resolves
    await page
      .locator('text=/Edit OTTL —/i')
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    await shoot(page, "04-clone-edit-drawer-open");
  });

  await step(results, "modify-and-save-ottl", async () => {
    const ta = page
      .locator('textarea, [contenteditable="true"]')
      .first();
    if (!(await ta.count())) throw new Error("OTTL textarea not found");
    const probe = `# dogfood-ariana-${Date.now()}\n`;
    await ta.click();
    await ta.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      t.focus();
    });
    await page.keyboard.type(probe);
    await page.waitForTimeout(300);
    const saveBtn = page
      .locator('button:has-text("Save OTTL")')
      .first();
    await saveBtn.click();
    await page.waitForTimeout(1500);
    await shoot(page, "05-after-save-ottl");
  });

  await step(results, "find-org-authored-row", async () => {
    // Close any open drawer first
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page
      .locator('text="Org-authored"')
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    await shoot(page, "06-list-with-org-authored-row");
  });

  await step(results, "edit-ottl-button-visible", async () => {
    const editBtn = page.locator('button:has-text("Edit OTTL")').first();
    await editBtn.waitFor({ state: "visible", timeout: 3_000 });
    await editBtn.click();
    await page.waitForTimeout(800);
    await shoot(page, "07-edit-org-ottl-drawer");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  await step(results, "archive-org-authored-row", async () => {
    const trashBtn = page
      .locator('button[aria-label*="rash"], button:has(svg)')
      .filter({ has: page.locator('svg') })
      .last(); // Last action button — the archive trash icon
    // Better: use the colorPalette=red button shape
    const redArchive = page
      .locator('button.css-')
      .filter({ hasText: "" });
    // Fallback: last button in the org row Actions column
    const archiveCandidates = page.locator(
      'tr:has(span:has-text("Org-authored")) button',
    );
    const count = await archiveCandidates.count();
    if (count < 2)
      throw new Error(`expected 2+ buttons in org row, got ${count}`);
    await archiveCandidates.last().click();
    await page.waitForTimeout(1000);
    await shoot(page, "08-after-archive");
  });

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const summary = {
    passed,
    failed,
    total: results.length,
    results,
    output: OUT_DIR,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`\nresults: ${passed} pass / ${failed} fail`);
  console.log(`screenshots + report.json: ${OUT_DIR}`);
  process.exit(failed > 0 ? 1 : 0);
})();
