// Boot smoke test: loads the production bundle in a headless browser and
// fails if the app does not mount, or if any emitted chunk throws a fatal
// module-init error.
//
// This catches a class of bug that `vite build` succeeding cannot: a bundle
// that compiles cleanly but breaks at runtime because the bundler split a
// cross-chunk export into a chunk that references a not-yet-initialized
// binding. That shows up as a white screen at boot (the Shiki regression) or
// as "X is not a constructor" the moment a lazy chunk's top-level code runs
// (e.g. a server-only `new AsyncLocalStorage()` leaking into a client chunk).
//
// Two phases, no backend required:
//   1. Boot — the app mounts (React renders the shell / error states even when
//      API calls fail, so an empty #root means the JS never booted).
//   2. Chunk scan — every emitted JS chunk is imported so its top-level code
//      runs. Boot only exercises the entry + eagerly-loaded chunks; lazy route
//      and feature chunks (where these regressions hide) only evaluate here.
//
// Note this is an init-time net: a bug that only throws when a function is
// *called* (not at module load) still needs an interaction/e2e test.
import { chromium } from "playwright";
import { readdirSync } from "node:fs";

const baseUrl = process.env.SMOKE_URL ?? "http://localhost:4173/";
// Where `vite build` writes the client chunks, relative to the cwd the script
// runs from (langwatch/).
const assetsDir = process.env.SMOKE_ASSETS_DIR ?? "dist/client/assets";
// "is not a constructor" is the signature of a chunk resolving a cross-chunk
// export to an uninitialized value and only failing when the value is `new`'d.
const FATAL =
  /is not a function|is not a constructor|Cannot access .* before initialization|is not defined/;

// In CI we point at the runner's preinstalled Google Chrome
// (SMOKE_BROWSER_CHANNEL=chrome) to skip the ~170 MB Chromium download.
// Locally it falls back to Playwright's bundled Chromium.
const channel = process.env.SMOKE_BROWSER_CHANNEL || undefined;
const browser = await chromium.launch(channel ? { channel } : {});
const page = await (await browser.newContext()).newPage();

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
  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  // Scan from a terminal public page (/auth/signin) so nothing redirects
  // mid-scan and tears down the JS context we're importing into.
  await page.goto(new URL("/auth/signin", baseUrl).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const chunkErrors = await page.evaluate(async (names) => {
    const errs = [];
    // Sequential so a chunk that navigates can't abort the whole batch.
    for (const name of names) {
      try {
        await import(`/assets/${name}`);
      } catch (e) {
        errs.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return errs;
  }, files);
  scanned = files.length;
  // Only the chunk-init signatures we care about fail the build. Anything else
  // a chunk might throw on import in a headless/no-backend context is surfaced
  // as a warning so a benign quirk can't wedge CI.
  for (const e of chunkErrors) {
    if (FATAL.test(e)) fatal.push(`chunk failed to evaluate: ${e}`);
    else console.warn(`WARN non-fatal chunk import error: ${e}`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fatal.push(`chunk scan did not run: ${message}`);
}

await browser.close();

if (fatal.length > 0) {
  console.error("BOOT SMOKE FAILED:");
  for (const f of fatal) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `BOOT SMOKE PASSED (#root mounted: ${mounted}, chunks scanned: ${scanned})`,
);
