/**
 * Captures the coding-agent E2E dogfood evidence: traces list + Terminal +
 * Session tabs of the real nested-run traces on the local branch stack.
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const PROJECT = "local-dev-project-jcq4ii";
const OUTER_TRACE = "a9b4d26c775ec3ae84baa4fc33c50828";
const CHILD_TRACE = "b7c3c72286083d6a1f5c40bae447839e";
const AGENT_TRACES: Array<[string, string]> = [
  ["05-gemini-terminal", "12e266f98539369fc63b6ea38d4a959c"],
  ["06-opencode-terminal", "71e8f5bd85e5e307f3a58fe6e1667aa8"],
  ["07-codex-terminal", "ef1a15ceba8c812c9336de7f14076383"],
  ["08-copilot-terminal", "2b5a083a33cc06db2538356762c49664"],
];
const OUT_DIR = "/tmp/cam-shots";

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`captured ${name}.png`);
}

void (async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 950 },
  });

  await page.goto(`${BASE_URL}/auth/signin`);
  await page.waitForSelector('input[name="email"], input[type="email"]', {
    timeout: 30_000,
  });
  await page.fill(
    'input[name="email"], input[type="email"]',
    "admin@local.langwatch.dev",
  );
  await page.fill(
    'input[name="password"], input[type="password"]',
    "LocalAdmin!2026",
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
    process.exit(1);
  }
  console.log("logged in ->", page.url());

  // Data-aware waits everywhere: every shot waits for rendered CONTENT (the
  // banner name, a counters row, or the contentless note), never a fixed
  // sleep — a fixed sleep screenshots the loading skeleton on cold caches.
  // Local ClickHouse shares its 50-query concurrency budget with every other
  // worktree's stack, so a page load can starve and stick on skeletons; a
  // reload re-fires the queries, so each shot retries with reloads instead
  // of trusting one navigation.
  const TERMINAL_READY =
    "text=/reported tokens|Claude Code v|Gemini CLI v|opencode v|Codex v|Copilot v/";
  const SESSION_READY = "text=/model calls|no usage summary/i";

  async function capture(url: string, selector: string, name: string) {
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

  await capture(
    `${BASE_URL}/${PROJECT}/traces`,
    "text=telemetry dogfood",
    "01-traces-list",
  );
  await capture(
    `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=terminal`,
    TERMINAL_READY,
    "02-claude-terminal",
  );
  await capture(
    `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=session`,
    SESSION_READY,
    "03-claude-session",
  );
  // The child claude session proves sub-sessions record independently.
  await capture(
    `${BASE_URL}/${PROJECT}/traces/${CHILD_TRACE}?drawer.mode=session`,
    SESSION_READY,
    "04-child-session",
  );
  for (const [name, traceId] of AGENT_TRACES) {
    await capture(
      `${BASE_URL}/${PROJECT}/traces/${traceId}?drawer.mode=terminal`,
      TERMINAL_READY,
      name,
    );
  }

  await browser.close();
})();
