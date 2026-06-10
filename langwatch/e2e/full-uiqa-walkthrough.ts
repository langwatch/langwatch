/**
 * Full from-scratch UI re-QA walkthrough — rchaves directive after sidebar
 * regroup (a3628655a) + BetaPill purple-fix (99a9ef066). Walks every major
 * governance flow as a real user, capturing the new "GOVERN" sidebar
 * grouping in every frame.
 *
 * Sections:
 *  A. /me portal — admin POV
 *  B. Govern → AI Gateway sub-tree (virtual-keys list, budgets, usage)
 *  C. Govern → Governance bird-eye + Tool Catalog + Anomaly Rules + Ingestion + Routing
 *  D. Settings → Members + Teams + Roles + Audit Log
 *  E. Tile install drawer (Claude Code)
 *  F. AI Tools Portal cold visit (workspace switcher, /me/sessions, /me/settings)
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.resolve(__dirname, "auth.json");
const OUT_DIR = "/tmp/full-uiqa";
const PROJECT_SLUG = process.env.PROJECT_SLUG ?? "ariana-zone-co-8jy0rB";

async function shoot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
  console.log(`captured ${name}.png`);
}

async function tryGoto(page: Page, name: string, url: string, waitForText?: string | RegExp) {
  try {
    const resp = await page.goto(`${BASE_URL}${url}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const status = resp?.status() ?? 0;
    console.log(`[${name}] ${url} -> ${status}`);
    if (waitForText) {
      await page.waitForSelector(`text=${waitForText instanceof RegExp ? `/${waitForText.source}/${waitForText.flags}` : waitForText}`, {
        timeout: 15_000,
      }).catch((e) => console.log(`[${name}] waitForText timed out: ${e.message}`));
    }
    await page.waitForTimeout(1500);
    return status;
  } catch (e) {
    console.log(`[${name}] ${url} -> error: ${(e as Error).message}`);
    return 0;
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
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // ============================================================
  // SECTION A — /me portal (admin POV)
  // ============================================================
  await tryGoto(page, "A1-me", "/me", /Claude Code|Cursor|Workspaces/);
  await shoot(page, "A1-me-portal-cold", true);

  // workspace switcher dropdown
  const switcherTrigger = page.locator('button[aria-label*="Switch workspace"]').first();
  if (await switcherTrigger.count() > 0) {
    await switcherTrigger.click();
    await page.waitForTimeout(700);
    await shoot(page, "A2-workspace-switcher");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  await tryGoto(page, "A3-me-sessions", "/me/sessions");
  await shoot(page, "A3-me-sessions");

  await tryGoto(page, "A4-me-settings", "/me/settings");
  await shoot(page, "A4-me-settings");

  // ============================================================
  // SECTION B — Govern > AI Gateway (NEW SIDEBAR section)
  // ============================================================
  await tryGoto(page, "B1-vk-list", `/${PROJECT_SLUG}/gateway/virtual-keys`, /Virtual Keys|Generate|No virtual keys/);
  await shoot(page, "B1-gateway-virtual-keys-list", true);

  await tryGoto(page, "B2-budgets", `/${PROJECT_SLUG}/gateway/budgets`);
  await shoot(page, "B2-gateway-budgets", true);

  await tryGoto(page, "B3-usage", `/${PROJECT_SLUG}/gateway/usage`);
  await shoot(page, "B3-gateway-usage", true);

  // ============================================================
  // SECTION C — Govern > Governance (bird-eye + sub-pages)
  // ============================================================
  await tryGoto(page, "C1-birdeye", "/settings/governance", /teams shown|Engineering|Marketing|OPEN ANOMALIES/);
  await shoot(page, "C1-governance-birdeye", true);

  await tryGoto(page, "C2-toolcatalog", "/settings/governance/tool-catalog");
  await shoot(page, "C2-tool-catalog-list", true);

  // Click "+ New" or first tile to open drawer
  const newTileBtn = page.locator('button:has-text("New tile"), button:has-text("+ New"), button:has-text("Add tile")').first();
  if (await newTileBtn.count() > 0) {
    await newTileBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "C2b-tool-catalog-create-drawer", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  await tryGoto(page, "C3-anomalies", "/settings/governance/anomaly-rules");
  await shoot(page, "C3-anomaly-rules-list", true);

  const newAnomalyBtn = page.locator('button:has-text("+ New"), button:has-text("New rule"), button:has-text("Create rule")').first();
  if (await newAnomalyBtn.count() > 0) {
    await newAnomalyBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "C3b-anomaly-rule-create-drawer", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  await tryGoto(page, "C4-ingestion", "/settings/governance/ingestion-sources");
  await shoot(page, "C4-ingestion-sources-list", true);

  await tryGoto(page, "C5-routing", "/settings/governance/routing-policies");
  await shoot(page, "C5-routing-policies-list", true);

  // ============================================================
  // SECTION D — Settings > Members + Teams + Roles + Audit Log
  // ============================================================
  await tryGoto(page, "D1-members", "/settings/members");
  await shoot(page, "D1-members", true);

  await tryGoto(page, "D2-teams", "/settings/teams");
  await shoot(page, "D2-teams", true);

  await tryGoto(page, "D3-roles", "/settings/access-audit");
  await shoot(page, "D3-role-bindings", true);

  await tryGoto(page, "D4-auditlog", "/settings/audit-log", /Action|Actor|Target/);
  await shoot(page, "D4-audit-log", true);

  // ============================================================
  // SECTION E — Tile install drawer (Claude Code from /me catalog)
  // ============================================================
  await tryGoto(page, "E0-me-back", "/me", /Claude Code/);
  const claudeTile = page.locator('button:has-text("Claude Code"), [data-testid*="claude-code"], div:has-text("Claude Code")').first();
  if (await claudeTile.count() > 0) {
    await claudeTile.click().catch(() => {});
    await page.waitForTimeout(2000);
    await shoot(page, "E1-claude-code-install-drawer", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  await browser.close();
  console.log("done");
})();
