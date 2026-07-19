/**
 * Captures the coding-agent E2E dogfood evidence: traces list + Terminal +
 * Session tabs of the real nested-run traces on the local branch stack.
 */
import * as fs from "fs";
import * as path from "path";

import { chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const PROJECT = "local-dev-project-jcq4ii";
const OUTER_TRACE = "6088c5691a9e1177ee738e7897228d38";
const CHILD_TRACE = "a9b9c64f8b53f3c3c8397a1feb994218";
const AGENT_TRACES: Array<[string, string]> = [
  ["05-gemini-terminal", "1413e253e00eada61d4d37d260a6193b"],
  ["06-opencode-terminal", "0fd529d4e60f7ba9a0bd5799e514d50d"],
  ["07-codex-terminal", "c642eae1677da5ddc9b91103066a5336"],
  ["08-copilot-terminal", "3c4db830224ede997f954ea8d99c9561"],
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

  // Fresh credentials login.
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
      timeout: 20_000,
    });
  } catch {
    await shoot(page, "00-login-debug");
    console.log("login stuck at", page.url());
    console.log((await page.textContent("body"))?.slice(0, 400));
    process.exit(1);
  }
  console.log("logged in ->", page.url());

  // Traces list, waiting for the real dogfood row.
  await page.goto(`${BASE_URL}/${PROJECT}/traces`);
  await page.waitForSelector("text=telemetry dogfood", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shoot(page, "01-traces-list");

  // Outer session: Terminal tab.
  await page.goto(
    `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=terminal`,
  );
  await page.waitForTimeout(6000);
  await shoot(page, "02-outer-terminal");

  // Outer session: Session tab.
  await page.goto(
    `${BASE_URL}/${PROJECT}/traces/${OUTER_TRACE}?drawer.mode=session`,
  );
  await page.waitForTimeout(6000);
  await shoot(page, "03-outer-session");

  // Child claude session: Session tab (sub-session recorded independently).
  await page.goto(
    `${BASE_URL}/${PROJECT}/traces/${CHILD_TRACE}?drawer.mode=session`,
  );
  await page.waitForTimeout(6000);
  await shoot(page, "04-child-session");

  for (const [name, traceId] of AGENT_TRACES) {
    await page.goto(
      `${BASE_URL}/${PROJECT}/traces/${traceId}?drawer.mode=terminal`,
    );
    // Data-aware wait: the step counter renders only once the transcript
    // arrived; a fixed sleep screenshots the loading skeleton on cold caches.
    await page
      .waitForSelector("text=/step \\d/", { timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForTimeout(1500);
    await shoot(page, name);
  }

  await browser.close();
})();
