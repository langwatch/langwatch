/**
 * Trace + admin UX screenshot driver for dogfood walkthroughs.
 *
 * Uses an isolated chromium profile so it never collides with the
 * peer-agent playwright-mcp session on the shared host. Logs in via
 * the dogfood seed creds, then walks: `/me/traces` (personal Path B
 * view), admin governance pages, install drawer, and the trace
 * detail v2 drawer (`drawer.open=traceV2Details`).
 *
 * Env overrides:
 *   BASE_URL                  default http://localhost:5560
 *   DOGFOOD_USER_EMAIL        default dogfood@langwatch.local
 *   DOGFOOD_PASSWORD          default DogfoodPassword!2026
 *   OUT_DIR                   default ./.claude/dogfood-evidence/trace-walkthrough
 *   PERSONAL_PROJECT_SLUG     default personal-hc4fdei9kqog--yvcpd
 *   TRACE_IDS                 comma-separated trace ids for the detail loop
 *   TARGETS                   "all" or csv of:
 *                             me-home,me-traces,trace-details,me-configure,
 *                             me-sessions,admin-tool-catalog-templates,
 *                             admin-governance
 *   PLAYWRIGHT_TEST_PATH      absolute path to @playwright/test index.js
 *                             default = repo's langwatch/node_modules
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pwPath =
  process.env.PLAYWRIGHT_TEST_PATH ??
  resolve(__dirname, "../../langwatch/node_modules/@playwright/test/index.js");
const require_ = createRequire(import.meta.url);
const pwTest = require_(pwPath);
const { chromium } = pwTest;

const BASE = process.env.BASE_URL ?? "http://localhost:5560";
const EMAIL = process.env.DOGFOOD_USER_EMAIL ?? "dogfood@langwatch.local";
const PASSWORD = process.env.DOGFOOD_PASSWORD ?? "DogfoodPassword!2026";
const OUT = resolve(
  process.env.OUT_DIR ??
    resolve(__dirname, "../../.claude/dogfood-evidence/trace-walkthrough"),
);
mkdirSync(OUT, { recursive: true });

const targets = (process.env.TARGETS ?? "all").split(",").map((s) => s.trim());
const wants = (k) => targets.includes("all") || targets.includes(k);

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log("WROTE", path, "URL=", page.url());
}

async function login(page) {
  await page.goto(`${BASE}/auth/signin`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const emailInput = page
    .locator('input[name="email"], input[type="email"]')
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  await emailInput.fill(EMAIL);
  const pwInput = page
    .locator('input[name="password"], input[type="password"]')
    .first();
  await pwInput.fill(PASSWORD);
  const signIn = page.getByRole("button", { name: /sign in/i }).first();
  await signIn.click();
  await page
    .waitForURL((u) => !/\/auth\/signin/.test(u.toString()), {
      timeout: 25_000,
    })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  try {
    await login(page);
    await shot(page, "00-post-login");

    if (wants("me-home")) {
      await page.goto(`${BASE}/me`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(2000);
      await shot(page, "01-me-home-ai-tools");
      await page.screenshot({
        path: resolve(OUT, "01-me-home-ai-tools-full.png"),
        fullPage: true,
      });
    }

    if (wants("me-traces")) {
      const slug =
        process.env.PERSONAL_PROJECT_SLUG ?? "personal-hc4fdei9kqog--yvcpd";
      await page.goto(`${BASE}/${slug}/traces`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(4500);
      await shot(page, "02-me-traces-list");
    }

    if (wants("trace-details")) {
      const slug =
        process.env.PERSONAL_PROJECT_SLUG ?? "personal-hc4fdei9kqog--yvcpd";
      const traceIds = (process.env.TRACE_IDS ?? "")
        .split(",")
        .filter(Boolean);
      for (const [idx, tid] of traceIds.entries()) {
        // v2 lives at /traces (not /messages, which is the pre-v2 page),
        // and the v2 drawer is keyed by `drawer.open=traceV2Details`
        // (not `traceDetails`, which renders the pre-v2 drawer).
        const url = `${BASE}/${slug}/traces?view=table&drawer.open=traceV2Details&drawer.traceId=${tid}`;
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page.waitForTimeout(3500);
        await shot(page, `20-${idx}-trace-detail-thread-${tid.slice(0, 8)}`);
        try {
          await page
            .getByRole("tab", { name: /^trace details$/i })
            .first()
            .click({ timeout: 3000 });
          await page.waitForTimeout(2000);
          await shot(page, `21-${idx}-trace-detail-attrs-${tid.slice(0, 8)}`);
          await page.screenshot({
            path: resolve(
              OUT,
              `21-${idx}-trace-detail-attrs-${tid.slice(0, 8)}-full.png`,
            ),
            fullPage: true,
          });
        } catch (e) {
          console.log("trace-details tab miss", e?.message ?? e);
        }
      }
    }

    if (wants("me-configure")) {
      await page.goto(`${BASE}/me/configure`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(1500);
      await shot(page, "03-me-configure");
    }

    if (wants("me-sessions")) {
      await page.goto(`${BASE}/me/sessions`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(1500);
      await shot(page, "04-me-sessions");
    }

    if (wants("admin-tool-catalog-templates")) {
      await page.goto(`${BASE}/settings/governance/tool-catalog`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(2000);
      try {
        await page
          .getByRole("tab", { name: /ingestion templates/i })
          .first()
          .click();
        await page.waitForTimeout(1500);
        await shot(page, "17-admin-tool-catalog-templates");
      } catch (e) {
        console.log("templates tab miss", e?.message ?? e);
      }
    }

    if (wants("admin-governance")) {
      for (const [slug, file] of [
        ["settings/governance", "10-admin-governance-overview"],
        ["settings/governance/ingestion-sources", "11-admin-ingestion-sources"],
        ["settings/governance/tool-catalog", "12-admin-tool-catalog"],
        ["settings/governance/departments", "13-admin-departments"],
        ["settings/governance/users", "14-admin-users"],
        ["settings/governance/teams", "15-admin-teams"],
        ["settings/governance/anomaly-rules", "16-admin-anomaly-rules"],
      ]) {
        try {
          await page.goto(`${BASE}/${slug}`, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });
          await page.waitForTimeout(700);
          await shot(page, file);
        } catch (e) {
          console.log("SKIP", slug, e?.message ?? e);
        }
      }
    }
  } catch (e) {
    console.error("CAPTURE ERROR", e);
    await shot(page, "99-error-state");
    process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
