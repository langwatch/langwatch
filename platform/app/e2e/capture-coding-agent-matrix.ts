/**
 * Captures the coding-agent E2E dogfood evidence: traces list + Terminal +
 * Session tabs of the real nested-run traces on the local branch stack.
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const PROJECT = "local-dev-project-jcq4ii";
const OUTER_TRACE = "8b0d370605a5a40bf7f154abfb09faa9";
const CHILD_TRACE = "1d73629e2a03ee6c5cda994c69599a1a";
const AGENT_TRACES = [
  ["05-gemini-terminal", "b404e584f528005751647820c85f20d8"],
  ["06-opencode-terminal", "a1f8c1e86872d49fc24dcf9d8aff8591"],
  ["07-codex-terminal", "8e439e2cf9dd5896b5ce29f1d1cff749"],
  ["08-copilot-terminal", "714eee94aefad959915d499893508a01"],
] as const;
// A trace whose agent contributes no span facts to the session aggregate:
// its Session tab must show the honest empty state, never a zeroed summary.
const STUB_SESSION_TRACE = "a1f8c1e86872d49fc24dcf9d8aff8591";
const OUT_DIR = "/tmp/cam-shots";

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`captured ${name}.png`);
}

void (async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 950 },
    });

    await page.goto(`${BASE_URL}/auth/signin`);
    await page.waitForSelector('input[name="email"], input[type="email"]', {
      timeout: 30_000,
    });
    // The seeded local-dev admin; override for a stack seeded differently.
    await page.fill(
      'input[name="email"], input[type="email"]',
      process.env.LW_QA_EMAIL ?? "admin@local.langwatch.dev",
    );
    await page.fill(
      'input[name="password"], input[type="password"]',
      process.env.LW_QA_PASSWORD ?? "LocalAdmin!2026",
    );
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.pathname.includes("/auth/"), {
        timeout: 90_000,
      });
    } catch {
      await shoot(page, "00-login-debug");
      console.log("login stuck at", page.url());
      console.log((await page.textContent("body"))?.slice(0, 400));
      process.exitCode = 1;
      return;
    }
    console.log("logged in ->", page.url());

    // Every shot waits for rendered CONTENT (the banner name, a counters row,
    // or the contentless note) before its short settle delay — waiting on time
    // alone would screenshot the loading skeleton on cold caches. Local
    // ClickHouse shares its query-concurrency budget with every other
    // worktree's stack, so a page load can starve and stick on skeletons; a
    // reload re-fires the queries, so each shot retries with reloads instead
    // of trusting one navigation.
    const TERMINAL_READY =
      "text=/reported tokens|Claude Code v|Gemini CLI v|opencode v|Codex v|Copilot v/";
    const SESSION_READY = "text=/model calls|no usage summary/i";

    async function capture({
      url,
      selector,
      name,
    }: {
      url: string;
      selector: string;
      name: string;
    }) {
      for (let attempt = 1; ; attempt++) {
        await page.goto(url);
        // The first-visit product tour overlays a spotlight veil that washes
        // out every screenshot — skip it before waiting on content.
        try {
          await page.click("text=Skip tour", { timeout: 5_000 });
        } catch {
          // No tour this session.
        }
        try {
          await page.waitForSelector(selector, { timeout: 60_000 });
          break;
        } catch (error) {
          if (attempt >= 4) throw error;
          console.log(`${name}: content not ready, reloading (${attempt})`);
        }
      }
      await page.waitForTimeout(1500);
      await shoot(page, name);
    }

    await capture({
      url: `${BASE_URL}/${PROJECT}/traces`,
      selector: "text=telemetry dogfood",
      name: "01-traces-list",
    });
    await capture({
      url: `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=terminal`,
      selector: TERMINAL_READY,
      name: "02-claude-terminal",
    });
    await capture({
      url: `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=session`,
      selector: SESSION_READY,
      name: "03-claude-session",
    });
    // The child claude session proves sub-sessions record independently.
    await capture({
      url: `${BASE_URL}/${PROJECT}/traces/${CHILD_TRACE}?drawer.mode=session`,
      selector: SESSION_READY,
      name: "04-child-session",
    });
    for (const [name, traceId] of AGENT_TRACES) {
      await capture({
        url: `${BASE_URL}/${PROJECT}/traces/${traceId}?drawer.mode=terminal`,
        selector: TERMINAL_READY,
        name,
      });
    }
    await capture({
      url: `${BASE_URL}/${PROJECT}/traces/${STUB_SESSION_TRACE}?drawer.mode=session`,
      selector: SESSION_READY,
      name: "09-opencode-session-empty",
    });
    // The personal usage card sits at the bottom of /me — scroll it into view
    // so the shot shows the card, not the page header.
    await page.goto(`${BASE_URL}/me`);
    await page.waitForSelector("text=Coding-agent usage", { timeout: 60_000 });
    await page
      .locator("text=Coding-agent usage")
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    await shoot(page, "10-me-usage-card");
  } finally {
    await browser.close();
  }
})();
