// A third, independent verification pass on top of the scenario framework's
// own judge: after a scenario's conversation finishes, actually look at the
// real product surface in a real browser. Runs for every scenario via
// scenario-logger.ts (not opt-in per test) — a pure evidence screenshot when
// there's nothing to assert, a real DOM check when there is.
//
// Auth is a real UI sign-in (not a cookie injected around it), done once per
// test file and reused across every scenario's browser-QA pass in that file —
// this also means a broken login page fails loudly instead of being skipped.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, "scenario-logs", "screenshots");

const APP_BASE =
  process.env.LANGY_APP_URL ??
  "https://app.langy-workspace.langwatch.localhost:1355";
const PROJECT_SLUG =
  process.env.LANGY_PROJECT_SLUG ??
  process.env.LANGY_PROJECT_ID ??
  "local-dev-project";
const ADMIN_EMAIL = process.env.LANGY_ADMIN_EMAIL ?? "admin@haven.localhost";
const ADMIN_PASSWORD =
  process.env.LANGY_ADMIN_PASSWORD ?? "LocalHavenAdmin!2026";

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

async function getSharedContext(): Promise<BrowserContext> {
  browserPromise ??= chromium.launch({ headless: true });
  const browser = await browserPromise;
  contextPromise ??= (async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${APP_BASE}/auth/signin`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
      timeout: 20_000,
    });
    await page.close();
    return context;
  })();
  return contextPromise;
}

/** Call in an `afterAll` if a test file wants a clean browser between files. */
export async function closeBrowserQA(): Promise<void> {
  const browser = browserPromise ? await browserPromise.catch(() => null) : null;
  await browser?.close().catch(() => {});
  browserPromise = null;
  contextPromise = null;
}

export interface BrowserQAResult {
  ok: boolean;
  notes: string;
  screenshotPath: string;
}

export interface BrowserQACheck {
  /** Used for the screenshot filename — keep short and unique per scenario. */
  label: string;
  /** Path within the project (e.g. "/prompts"). Defaults to the project home. */
  path?: string;
  /** Omit for a pure evidence screenshot (always ok:true, no assertion). */
  verify?: (page: Page) => Promise<{ ok: boolean; notes: string }>;
}

function slugify(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "unnamed"
  );
}

export async function browserQA(check: BrowserQACheck): Promise<BrowserQAResult> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const slug = slugify(check.label);
  let page: Page | null = null;
  try {
    const context = await getSharedContext();
    page = await context.newPage();
    // Org-scoped pages (e.g. AI Gateway's /settings/gateway/**) are absolute
    // — a leading "/settings" (or any leading "/" the caller wants taken
    // literally) skips the project-slug prefix. Project-scoped pages don't
    // start with "/", e.g. "/prompts".
    const target = (check.path ?? "").startsWith("/settings")
      ? `${APP_BASE}${check.path}`
      : `${APP_BASE}/${PROJECT_SLUG}${check.path ?? ""}`;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The app is a client-rendered SPA shell — wait for actual content, not
    // just DOM-ready, or the screenshot captures a blank/loading frame.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.locator("body").getByText(/./).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const verdict = check.verify
      ? await check.verify(page)
      : {
          ok: true,
          notes: "No side-effect to verify — screenshot captured as evidence.",
        };

    const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { ...verdict, screenshotPath };
  } catch (error) {
    const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}-error.png`);
    if (page) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return {
      ok: false,
      notes: `Browser QA threw: ${error instanceof Error ? error.message : String(error)}`,
      screenshotPath,
    };
  } finally {
    await page?.close().catch(() => {});
  }
}

/** Is `name` visible anywhere on the current page? Used for both "was it
 * really created" (normal scenarios) and "was it NOT actually destroyed"
 * (red-team scenarios that try to trick Langy into deleting something). */
export async function verifyTextVisible(
  page: Page,
  name: string,
): Promise<{ ok: boolean; notes: string }> {
  const visible = await page
    .getByText(name, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  return {
    ok: visible,
    notes: visible
      ? `Found "${name}" in the live UI.`
      : `Did NOT find "${name}" in the live UI.`,
  };
}

export async function verifyTextAbsent(
  page: Page,
  name: string,
): Promise<{ ok: boolean; notes: string }> {
  const visible = await page
    .getByText(name, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  return {
    ok: !visible,
    notes: visible
      ? `"${name}" is STILL visible in the live UI (should be absent).`
      : `"${name}" is correctly absent from the live UI.`,
  };
}
