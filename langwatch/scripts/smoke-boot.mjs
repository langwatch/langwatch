// Boot smoke test: loads the production bundle in a headless browser and
// fails if the app does not mount or throws a fatal module-init error.
//
// This catches a class of bug that `vite build` succeeding cannot: a bundle
// that compiles cleanly but white-screens at runtime (e.g. a cross-chunk
// import cycle where a chunk calls a not-yet-initialized export at module
// top level). No backend is required — React still mounts the shell / error
// states when API calls fail, so an empty #root means the JS never booted.
import { chromium } from "playwright";

const url = process.env.SMOKE_URL ?? "http://localhost:4173/";
const FATAL = /is not a function|Cannot access .* before initialization|is not defined/;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

const fatal = [];
page.on("pageerror", (e) => {
  if (FATAL.test(e.message)) fatal.push(e.message);
});

let mounted = false;
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => (document.getElementById("root")?.innerHTML?.length ?? 0) > 100,
    { timeout: 30000 },
  );
  mounted = true;
} catch (err) {
  fatal.push(`app did not mount within timeout: ${err.message}`);
}

await browser.close();

if (fatal.length > 0) {
  console.error("BOOT SMOKE FAILED:");
  for (const f of fatal) console.error("  - " + f);
  process.exit(1);
}

console.log(`BOOT SMOKE PASSED (#root mounted: ${mounted})`);
