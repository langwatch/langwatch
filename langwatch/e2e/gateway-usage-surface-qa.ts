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
 * Reads the page's settled state as one comparable string, evaluated in the
 * browser. An empty result means the usage query is still in flight: the page
 * is showing a bare spinner and none of its three settled states has
 * rendered yet.
 */
const READ_USAGE_STATE = () => {
  const text = document.body.innerText;
  if (text.includes("No usage in this window")) return "empty";
  if (text.includes("Failed to load usage")) return "error";
  const total = /Total spend\s*\$([\d.,]+)/.exec(text);
  return total ? `$${total[1]}` : "";
};

/**
 * Waiting for the page to settle rather than for a fixed interval is what
 * stops a slow first compile from being read as an empty window: on a cold
 * dev server the old fixed waits elapsed while the spinner was still up, so
 * the empty-state checks passed against a page that had rendered nothing and
 * the captured mobile screenshot came out blank.
 */
async function waitForUsageSettled(page: Page) {
  await page.waitForFunction(READ_USAGE_STATE, undefined, { timeout: 60_000 });
}

/**
 * Changing the window or clearing the key filter starts a fresh query, and
 * the previous render stays on screen until it resolves. Settling alone is
 * not enough to wait for here, in either direction: checked immediately it
 * still sees the OLD total, and checked again it briefly sees the spinner. So
 * require a settled state whose total DIFFERS from the one on screen before
 * the click. Without this the "after Last 7 days" capture came out
 * byte-identical to the month-to-date one it was meant to contrast with.
 */
async function actAndAwaitNewUsage(page: Page, act: () => Promise<void>) {
  const before = await page.evaluate(READ_USAGE_STATE);
  await act();
  await page.waitForFunction(
    (previous: string) => {
      const text = document.body.innerText;
      if (text.includes("No usage in this window")) return previous !== "empty";
      if (text.includes("Failed to load usage")) return previous !== "error";
      const total = /Total spend\s*\$([\d.,]+)/.exec(text);
      return !!total && `$${total[1]}` !== previous;
    },
    before,
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
  await actAndAwaitNewUsage(page, () =>
    page.getByRole("button", { name: "Last 7 days" }).click(),
  );
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
  await actAndAwaitNewUsage(page, () =>
    page.getByRole("button", { name: "Clear key filter" }).click(),
  );
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
