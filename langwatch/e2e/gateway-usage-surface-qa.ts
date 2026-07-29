/**
 * Browser QA for the AI Gateway usage surface.
 *
 * Signs in as an org admin of the dogfood organization, then walks the
 * three defects: the Usage page rendering real spend, the filter controls
 * staying on the usage route, and the chart-line affordance in the keys
 * table. Captures desktop and 390px-wide shots for the PR.
 */
import { hash } from "bcrypt";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:5590";

// This script writes a known password onto a real user row to obtain a
// session, so it must only ever point at a local dev stack.
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL)) {
  throw new Error(`refusing to run against a non-local target: ${BASE_URL}`);
}
const EMAIL = "dogfood@langwatch.local";
const PASSWORD = "gateway-usage-qa-2026";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp/gateway-usage-qa";
const ORG_ID = "organization_0000USx9WDgmDaA9x5FrQykVHuuwa";
const VIEWER_PROJECT_SLUG = "rogerio-org-z7Rkq0";

const results: Array<{ ok: boolean; label: string; detail?: string }> = [];
function check(label: string, ok: boolean, detail?: string) {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function ensureCredentials(): Promise<string> {
  const { prisma } = await import("../src/server/db");
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error(`no user ${EMAIL}`);
  const passwordHash = await hash(PASSWORD, 10);
  const existing = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: { password: passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        id: `qa_cred_${user.id}`,
        userId: user.id,
        type: "credential",
        provider: "credential",
        providerAccountId: user.id,
        password: passwordHash,
      },
    });
  }
  return user.id;
}

/**
 * Signs in through the auth API in-process. The HTTP route rejects a
 * cross-port Origin, and the dev server's trusted origin is the default
 * port rather than whichever one QA runs on.
 */
async function sessionCookie(): Promise<{ name: string; value: string }> {
  const { auth } = await import("../src/server/better-auth");
  const res = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  if (res.status !== 200) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const m = /^([^=]+)=([^;]+)/.exec(c);
    if (m && m[1]!.includes("session_token")) {
      return { name: m[1]!, value: decodeURIComponent(m[2]!) };
    }
  }
  throw new Error(`no session cookie in: ${JSON.stringify(raw)}`);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  console.log(`   shot ${name}.png`);
}

async function main() {
  const { mkdir } = await import("fs/promises");
  await mkdir(SHOT_DIR, { recursive: true });

  await ensureCredentials();
  const cookie = await sessionCookie();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 950 },
    deviceScaleFactor: 2,
  });
  await context.addCookies([
    { ...cookie, domain: "localhost", path: "/", httpOnly: true, secure: false },
  ]);
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
  await page.goto(`${BASE_URL}/settings/gateway/virtual-keys`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Spent this month", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const chartButtons = await page.locator('[data-testid^="vk-spend-chart-"]').count();
  check("chart-line icon button renders in the spend cell", chartButtons > 0, `${chartButtons} buttons`);
  const spendCells = await page.locator('[data-testid^="vk-spend-"]').count();
  check("spend values render", spendCells > 0, `${spendCells} cells`);
  await shot(page, "01-virtual-keys-desktop");

  // ── Defect 1: click the affordance, expect real data ──────────────
  const targetVk = "vk_LtNASRpf1LqLTo5TvMAfnA";
  await page.locator(`[data-testid="vk-spend-chart-${targetVk}"]`).click();
  await page.waitForTimeout(3000);
  check(
    "the chart icon deep-links to the usage route with the key filter",
    page.url().includes("/settings/gateway/usage") && page.url().includes(targetVk),
    page.url(),
  );
  const emptyState = await page.locator("text=No usage in this window").count();
  check("usage page is NOT the empty state for a key with spend", emptyState === 0);
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const hasMoney = /\$\d/.test(bodyText);
  check("usage page renders a dollar total", hasMoney);
  await shot(page, "02-usage-filtered-desktop");

  // ── Defect 2: date presets keep the route ─────────────────────────
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await page.waitForTimeout(1500);
  const afterPreset = new URL(page.url());
  check(
    "date preset stays on /settings/gateway/usage",
    afterPreset.pathname.replace(/\/$/, "") === "/settings/gateway/usage",
    page.url(),
  );
  check("date preset keeps the vk filter", afterPreset.searchParams.get("vk") === targetVk);
  check("date preset sets days=7", afterPreset.searchParams.get("days") === "7");
  await shot(page, "03-usage-after-7d-desktop");

  // ── Defect 2: chip dismissal keeps the route ──────────────────────
  await page.getByRole("button", { name: "Clear key filter" }).click();
  await page.waitForTimeout(2000);
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
  await mobile.addCookies([
    { ...cookie, domain: "localhost", path: "/", httpOnly: true, secure: false },
  ]);
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
  await mpage.goto(`${BASE_URL}/settings/gateway/usage?vk=${targetVk}&days=30`, { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(4000);
  const mobileEmpty = await mpage.locator("text=No usage in this window").count();
  const mobileError = await mpage.locator("text=Failed to load").count();
  check("mobile usage renders data", mobileEmpty === 0 && mobileError === 0);
  await mpage.screenshot({ path: `${SHOT_DIR}/05-usage-mobile.png`, fullPage: true });
  console.log("   shot 05-usage-mobile.png");
  await mpage.goto(`${BASE_URL}/settings/gateway/virtual-keys`, { waitUntil: "domcontentloaded" });
  await mpage.waitForTimeout(3000);
  await mpage.screenshot({
    path: `${SHOT_DIR}/06-virtual-keys-mobile.png`,
    fullPage: true,
  });
  console.log("   shot 06-virtual-keys-mobile.png");

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
