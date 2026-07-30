/**
 * Browser QA for the AI Gateway usage surface.
 *
 * Signs in as an org admin of the dogfood organization, then walks the
 * three defects: the Usage page rendering real spend, the filter controls
 * staying on the usage route, and the chart-line affordance in the keys
 * table. Captures desktop and 390px-wide shots for the PR.
 *
 * Run it against a local stack, with the app's env loaded so the Prisma and
 * auth imports resolve their configuration:
 *
 *   QA_PASSWORD=<throwaway> QA_BASE_URL=http://localhost:5590 \
 *     pnpm exec tsx --env-file=.env e2e/gateway-usage-surface-qa.ts
 */
import { mkdir } from "fs/promises";
import { chromium, type Page } from "playwright";

import { localQaSessionCookie } from "./qa-local-session";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:5590";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/gateway-usage-qa";
const ORG_ID = "organization_0000USx9WDgmDaA9x5FrQykVHuuwa";
const VIEWER_PROJECT_SLUG = "rogerio-org-z7Rkq0";

const results: Array<{ ok: boolean; label: string; detail?: string }> = [];
function check(label: string, ok: boolean, detail?: string) {
  results.push({ ok, label, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  console.log(`   shot ${name}.png`);
}

/**
 * The page shows a bare spinner while the usage query is in flight, and each
 * of its three settled states carries a distinct heading. Waiting for one of
 * them rather than for a fixed interval is what stops a slow first compile
 * from being read as an empty window.
 */
async function waitForUsageSettled(page: Page) {
  await page.waitForFunction(
    () =>
      ["Total spend", "No usage in this window", "Failed to load usage"].some(
        (marker) => document.body.innerText.includes(marker),
      ),
    undefined,
    { timeout: 60_000 },
  );
}

async function main() {
  const cookie = await localQaSessionCookie(BASE_URL);
  await mkdir(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 950 },
    deviceScaleFactor: 2,
  });
  await context.addCookies([cookie]);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`   [browser error] ${m.text()}`);
  });

  // The viewer sits on an ordinary project, not the governance project
  // the org-scoped keys' traces land in. That is the production shape the
  // Usage page used to render empty under.
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([org, slug]) => {
      localStorage.setItem("selectedOrganizationId", JSON.stringify(org));
      localStorage.setItem("selectedProjectSlug", JSON.stringify(slug));
    },
    [ORG_ID, VIEWER_PROJECT_SLUG],
  );

  // ── Defect 3: the keys table affordance ───────────────────────────
  await page.goto(`${BASE_URL}/settings/gateway/virtual-keys`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector("text=Spent this month", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const chartButtons = await page
    .locator('[data-testid^="vk-spend-chart-"]')
    .count();
  check(
    "chart-line icon button renders in the spend cell",
    chartButtons > 0,
    `${chartButtons} buttons`,
  );
  const spendCells = await page.locator('[data-testid^="vk-spend-"]').count();
  check("spend values render", spendCells > 0, `${spendCells} cells`);
  await shot(page, "01-virtual-keys-desktop");

  // ── Defect 1: click the affordance, expect real data ──────────────
  const targetVk = "vk_LtNASRpf1LqLTo5TvMAfnA";
  await page.locator(`[data-testid="vk-spend-chart-${targetVk}"]`).click();
  await waitForUsageSettled(page);
  check(
    "the chart icon deep-links to the usage route with the key filter",
    page.url().includes("/settings/gateway/usage") &&
      page.url().includes(targetVk),
    page.url(),
  );
  const emptyState = await page.locator("text=No usage in this window").count();
  check(
    "usage page is NOT the empty state for a key with spend",
    emptyState === 0,
  );
  const bodyText = (await page.locator("body").innerText()).replace(
    /\s+/g,
    " ",
  );
  const hasMoney = /\$\d/.test(bodyText);
  check("usage page renders a dollar total", hasMoney);
  await shot(page, "02-usage-filtered-desktop");

  // ── Defect 2: date presets keep the route ─────────────────────────
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await waitForUsageSettled(page);
  const afterPreset = new URL(page.url());
  check(
    "date preset stays on /settings/gateway/usage",
    afterPreset.pathname.replace(/\/$/, "") === "/settings/gateway/usage",
    page.url(),
  );
  check(
    "date preset keeps the vk filter",
    afterPreset.searchParams.get("vk") === targetVk,
  );
  check(
    "date preset sets days=7",
    afterPreset.searchParams.get("days") === "7",
  );
  await shot(page, "03-usage-after-7d-desktop");

  // ── Defect 2: chip dismissal keeps the route ──────────────────────
  await page.getByRole("button", { name: "Clear key filter" }).click();
  await waitForUsageSettled(page);
  const afterChip = new URL(page.url());
  check(
    "chip dismissal stays on /settings/gateway/usage",
    afterChip.pathname.replace(/\/$/, "") === "/settings/gateway/usage",
    page.url(),
  );
  check("chip dismissal drops vk", afterChip.searchParams.get("vk") === null);
  const orgEmpty = await page.locator("text=No usage in this window").count();
  check("org-wide usage renders data too", orgEmpty === 0);
  await shot(page, "04-usage-org-wide-desktop");

  // ── Mobile 390px ──────────────────────────────────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.addCookies([cookie]);
  const mpage = await mobile.newPage();
  // A fresh context starts with empty storage, so it would resolve to
  // whichever org sorts first rather than the one under test.
  await mpage.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
  await mpage.evaluate(
    ([org, slug]) => {
      localStorage.setItem("selectedOrganizationId", JSON.stringify(org));
      localStorage.setItem("selectedProjectSlug", JSON.stringify(slug));
    },
    [ORG_ID, VIEWER_PROJECT_SLUG],
  );
  await mpage.goto(
    `${BASE_URL}/settings/gateway/usage?vk=${targetVk}&days=30`,
    { waitUntil: "domcontentloaded" },
  );
  await waitForUsageSettled(mpage);
  const mobileEmpty = await mpage
    .locator("text=No usage in this window")
    .count();
  const mobileError = await mpage.locator("text=Failed to load").count();
  check("mobile usage renders data", mobileEmpty === 0 && mobileError === 0);
  await mpage.screenshot({
    path: `${SHOT_DIR}/05-usage-mobile.png`,
    fullPage: true,
  });
  console.log("   shot 05-usage-mobile.png");
  await mpage.goto(`${BASE_URL}/settings/gateway/virtual-keys`, {
    waitUntil: "domcontentloaded",
  });
  await mpage.waitForTimeout(3000);
  await mpage.screenshot({
    path: `${SHOT_DIR}/06-virtual-keys-mobile.png`,
    fullPage: true,
  });
  console.log("   shot 06-virtual-keys-mobile.png");

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
