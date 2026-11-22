// Boot smoke test (specs/ops/production-bundle-integrity.feature): loads the
// production bundle in a headless browser, fails if the app does not mount or
// if any emitted chunk throws a fatal module-init error when imported.
// No backend is required. Errors thrown only when a function is called still
// need an interaction or e2e test.

import { readdirSync } from "node:fs";

import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_URL ?? "http://localhost:4173/";
// Where `vite build` writes the client chunks, relative to apps/ui.
const assetsDir = process.env.SMOKE_ASSETS_DIR ?? "dist/client/assets";
// "is not a constructor" is the signature of a chunk resolving a cross-chunk
// export to an uninitialized value and only failing when the value is `new`'d.
const FATAL =
  /is not a function|is not a constructor|Cannot access .* before initialization|is not defined/;

// In CI we point at the runner's preinstalled Google Chrome
// (SMOKE_BROWSER_CHANNEL=chrome) to skip the ~170 MB Chromium download.
// Locally it falls back to Playwright's bundled Chromium.
const channel = process.env.SMOKE_BROWSER_CHANNEL || undefined;
// A blocked renderer cannot run an in-page timeout. Keep the deadline in Node.
const watchdog = setTimeout(() => {
  console.error("BOOT SMOKE FAILED: exceeded the five-minute deadline");
  process.exit(1);
}, 300_000);
watchdog.unref();
// Own the process so shutdown can terminate this smoke browser's children too.
const server = await chromium.launchServer({ host: "127.0.0.1", channel });
const browser = await chromium.connect(server.wsEndpoint(), {
  timeout: 30_000,
});
const context = await browser.newContext();
const page = await context.newPage();

const fatal = [];
page.on("pageerror", (e) => {
  if (FATAL.test(e.message)) fatal.push(e.message);
});

// Phase 1 — the app mounts.
let mounted = false;
try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => (document.getElementById("root")?.innerHTML?.length ?? 0) > 100,
    void 0,
    { timeout: 30000 },
  );
  mounted = true;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fatal.push(`app did not mount within timeout: ${message}`);
}

// Phase 2 — every emitted chunk evaluates without a module-init error.
let scanned = 0;
try {
  const files = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .toSorted();
  if (files.length === 0) throw new Error("no emitted JavaScript chunks found");
  // Scan from a terminal public page so nothing redirects mid-scan. The signin
  // page rewrites its own URL, which Playwright can report as an interrupted
  // navigation; wait for the URL to settle instead.
  const signinUrl = new URL("/auth/signin", baseUrl).toString();
  try {
    await page.goto(signinUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const redirected =
      message.includes("interrupted by another navigation") || message.includes("net::ERR_ABORTED");
    if (!redirected) throw err;
  }
  await page.waitForURL(/\/auth\/signin/, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // Batch browser round trips while still evaluating every emitted chunk.
  // The deadline lives in Node so a blocked renderer cannot bypass it.
  for (let offset = 0; offset < files.length; offset += 32) {
    const batch = files.slice(offset, offset + 32);
    console.log(`Importing chunks ${offset + 1}-${offset + batch.length}/${files.length}`);
    const errors = await withinDeadline(
      page.evaluate(importChunksInPage(batch)),
      15_000,
      `chunk imports timed out: ${batch.join(", ")}`,
    );
    scanned += batch.length;
    for (const error of errors) {
      if (error === null) continue;
      if (FATAL.test(error)) fatal.push(`chunk failed to evaluate: ${error}`);
      else console.warn(`WARN non-fatal chunk import error: ${error}`);
    }
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fatal.push(`chunk scan did not run: ${message}`);
}

try {
  await withinDeadline(context.close(), 10_000, "context shutdown timed out");
} catch (err) {
  fatal.push(err instanceof Error ? err.message : String(err));
}
try {
  await withinDeadline(browser.close(), 10_000, "browser disconnect timed out");
} catch (err) {
  fatal.push(err instanceof Error ? err.message : String(err));
}
try {
  await withinDeadline(server.kill(), 10_000, "browser shutdown timed out");
} catch (err) {
  fatal.push(err instanceof Error ? err.message : String(err));
}
clearTimeout(watchdog);

if (fatal.length > 0) {
  console.error("BOOT SMOKE FAILED:");
  for (const f of fatal) console.error("  - " + f);
  process.exit(1);
}

console.log(`BOOT SMOKE PASSED (#root mounted: ${mounted}, chunks scanned: ${scanned})`);

/**
 * @template T
 * @param {Promise<T>} operation
 * @param {number} timeoutMs
 * @param {string} message
 */
async function withinDeadline(operation, timeoutMs, message) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    /** @type {Promise<never>} */
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page-side script importing each chunk, as source text: it runs in the
 * browser, so the module loader it calls is the page's, not this script's.
 * @param {string[]} chunks
 * @returns {string}
 */
function importChunksInPage(chunks) {
  return `Promise.all(${JSON.stringify(chunks)}.map(async (chunk) => {
    try {
      await import("/assets/" + chunk);
      return null;
    } catch (e) {
      return chunk + ": " + (e instanceof Error ? e.message : String(e));
    }
  }))`;
}
