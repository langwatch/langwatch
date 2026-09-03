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
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_BASE, PROJECT_SLUG } from "./config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, "scenario-logs", "screenshots");
const VIDEO_DIR = path.resolve(__dirname, "scenario-logs", "videos");

/**
 * Opt-in video recording: LANGY_QA_VIDEO=1 records every page in the shared
 * context to scenario-logs/videos as .webm. Playwright only finalizes the
 * files when the CONTEXT closes, so a recording run must end with
 * closeBrowserQA() (an afterAll in the suite, or the process exiting through
 * vitest's teardown) or the videos stay half-written.
 */
const RECORD_VIDEO = process.env.LANGY_QA_VIDEO === "1";

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

/**
 * Clears the corresponding cache on rejection — otherwise a single transient
 * launch/login failure would permanently disable browser QA for every
 * remaining scenario in the run (`??=` only checks null/undefined at
 * assignment time, and a rejected promise is neither).
 */
async function getSharedContext(): Promise<BrowserContext> {
  browserPromise ??= chromium.launch({ headless: true }).catch((error) => {
    browserPromise = null;
    throw error;
  });
  const browser = await browserPromise;
  contextPromise ??= (async () => {
    try {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        ...(RECORD_VIDEO
          ? {
              recordVideo: {
                dir: VIDEO_DIR,
                size: { width: 1440, height: 900 },
              },
            }
          : {}),
      });
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
    } catch (error) {
      contextPromise = null;
      throw error;
    }
  })();
  return contextPromise;
}

/**
 * Call in an `afterAll` if a test file wants a clean browser between files.
 * The context closes before the browser on purpose: with LANGY_QA_VIDEO=1
 * that close is what finalizes the .webm files.
 */
export async function closeBrowserQA(): Promise<void> {
  const browser = browserPromise ? await browserPromise.catch(() => null) : null;
  await browser?.close().catch(() => {});
  browserPromise = null;
  contextPromise = null;
}

export interface BrowserQAVerdict {
  passed: boolean;
  notes: string;
}

export interface BrowserQAResult extends BrowserQAVerdict {
  screenshotPath: string;
}

export interface BrowserQACheck {
  /** Used for the screenshot filename — keep short and unique per scenario. */
  label: string;
  /** Path within the project (e.g. "/prompts"). Defaults to the project home. */
  path?: string;
  /** Omit for a pure evidence screenshot (always passed:true, no assertion). */
  verify?: (page: Page) => Promise<BrowserQAVerdict>;
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
    // Org-scoped pages are absolute: settings, and the top-level Gateway
    // and Governance products. They skip the project-slug prefix.
    // Project-scoped pages take the prefix, e.g. "/prompts".
    const checkPath = check.path ?? "";
    const isOrgScopedPath = ["/settings", "/gateway", "/governance"].some(
      (prefix) => checkPath === prefix || checkPath.startsWith(`${prefix}/`),
    );
    const target = isOrgScopedPath
      ? `${APP_BASE}${checkPath}`
      : `${APP_BASE}/${PROJECT_SLUG}${checkPath}`;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The app is a client-rendered SPA shell — wait for actual content, not
    // just DOM-ready, or the screenshot captures a blank/loading frame.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page
      .locator("body")
      .getByText(/./)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    const verdict: BrowserQAVerdict = check.verify
      ? await check.verify(page)
      : {
          passed: true,
          notes: "No side-effect to verify — screenshot captured as evidence.",
        };

    const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { ...verdict, screenshotPath };
  } catch (error) {
    const screenshotPath = path.join(SCREENSHOT_DIR, `${slug}-error.png`);
    if (page) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return {
      passed: false,
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
export async function verifyTextVisible({
  page,
  name,
}: {
  page: Page;
  name: string;
}): Promise<BrowserQAVerdict> {
  const visible = await page
    .getByText(name, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  return {
    passed: visible,
    notes: visible ? `Found "${name}" in the live UI.` : `Did NOT find "${name}" in the live UI.`,
  };
}

export async function verifyTextAbsent({
  page,
  name,
}: {
  page: Page;
  name: string;
}): Promise<BrowserQAVerdict> {
  const visible = await page
    .getByText(name, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  return {
    passed: !visible,
    notes: visible
      ? `"${name}" is STILL visible in the live UI (should be absent).`
      : `"${name}" is correctly absent from the live UI.`,
  };
}
