import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

import { checkBuild } from "./build-check.mjs";
import { startPreview } from "./preview-server.mjs";

const { values } = parseArgs({
  options: { "out-dir": { type: "string" }, screenshots: { type: "string" } },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = values.screenshots ?? (await mkdtemp(path.join(os.tmpdir(), "docs-smoke-")));
await mkdir(screenshots, { recursive: true });
const pages = ["introduction", "integration/quick-start", "api-reference/traces/get-trace"];

async function checkPage({ page, base, slug, width, mode }) {
  const response = await page.goto(`${base}${slug}`, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200, slug);
  await page.locator("h1").waitFor({ state: "visible" });
  assert.ok((await page.locator("h1").textContent()).trim().length > 0, `${slug} title`);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
    false,
    `${slug} overflow`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(screenshots, `${slug.replaceAll("/", "_")}-${width}-${mode}.png`),
    animations: "disabled",
  });
}

async function checkControls({ page, base }) {
  await page.goto(`${base}integration/quick-start`);
  await page.getByRole("button", { name: "Copy page", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  const markdown = await readFile(path.join(outDir, "integration/quick-start.md"), "utf8");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdown);
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox").fill("LANGWATCH_API_KEY");
  await page.locator("#docs-search-results a").first().waitFor();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .locator("#docs-search-results a")
      .first()
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await page.goto(`${base}api-reference/traces/get-trace`);
  await page.getByRole("button", { name: "Try it", exact: true }).click();
  const key = page.getByRole("textbox", { name: "X-Auth-Token value" });
  await key.waitFor({ state: "visible" });
  assert.equal(await key.getAttribute("type"), "password");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  assert.equal(await key.getAttribute("aria-invalid"), "true");
}

async function checkVariant({ browser, base, width, mode }) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1100 },
    colorScheme: mode,
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    await context.addInitScript((theme) => localStorage.setItem("theme", theme), mode);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://app.langwatch.ai/**", (route) => {
      apiCalls += 1;
      return route.abort();
    });
    for (const slug of pages) await checkPage({ page, base, slug, width, mode });
    await checkControls({ page, base });
    assert.equal(apiCalls, 0, "No API request is sent with empty authentication");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

/** @scenario "Build all configured documentation" */
await it("publishes exactly the configured inventory and its supporting files", async () => {
  await checkBuild({ outDir });
});

/** @scenario "Read the three key pages in both themes and viewport sizes" */
await it("renders and operates the key pages at 1440 and 390 in light and dark", async () => {
  const server = await startPreview({ outDir, port: 0 });
  let browser;
  try {
    browser = await chromium.launch();
    const base = server.resolvedUrls.local[0];
    for (const width of [1440, 390])
      for (const mode of ["light", "dark"]) {
        await checkVariant({ browser, base, width, mode });
      }
    console.log(`Screenshots: ${screenshots}`);
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

/** @scenario "Serve directory URLs consistently" */
await it("serves directory URLs, redirects and the generated 404", async () => {
  const server = await startPreview({ outDir, port: 0 });
  try {
    const base = server.resolvedUrls.local[0];
    for (const slug of pages) {
      const plain = await fetch(`${base}${slug}`);
      const trailing = await fetch(`${base}${slug}/`);
      assert.equal(plain.status, 200);
      assert.equal(await plain.text(), await trailing.text());
    }
    const redirects = JSON.parse(await readFile(path.join(outDir, "redirects.json"), "utf8"));
    for (const [source, destination] of Object.entries(redirects)) {
      const response = await fetch(`${base}${source.slice(1)}?docs-smoke=1`, {
        redirect: "manual",
      });
      assert.equal(response.status, 301, source);
      const location = new URL(response.headers.get("location"), base);
      const expected = new URL(destination, base);
      assert.equal(location.pathname, expected.pathname, source);
      assert.equal(location.hash, expected.hash, source);
      assert.equal(location.searchParams.get("docs-smoke"), "1", source);
    }
    const missing = await fetch(`${base}nonexistent-docs-smoke-route`);
    assert.equal(missing.status, 404);
    assert.ok((await missing.text()).includes("Search the docs"));
    assert.equal((await fetch(`${base}%ZZ`)).status, 400);
  } finally {
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
