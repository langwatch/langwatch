import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { assertBuild } from "../src/site/build-check.ts";
import { startPreview } from "../src/site/preview-server.ts";
import {
  assertAgentSetup,
  assertCapabilityErrors,
  assertClipboardReadiness,
  assertMobileNavigation,
  assertSkillCopy,
  assertStaticDiagrams,
  tracingPrompt,
} from "./browser-checks.mjs";
import { withPreviewBrowser, withReader } from "./browser-fixture.mjs";

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
    await page.getByRole("searchbox").evaluate((element) => element === document.activeElement),
    true,
  );
  const activeResult = await page.getByRole("searchbox").getAttribute("aria-activedescendant");
  assert.ok(await page.locator(`#${activeResult} a`).count());
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
    /* Top frame only: the aborted session frame is an error page whose storage access throws. */
    await context.addInitScript((theme) => {
      if (window.top === window) localStorage.setItem("theme", theme);
    }, mode);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors = [];
    let apiCalls = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    /* The session frame loads from the app too; only a request under /api is an API call. */
    await page.route("https://app.langwatch.ai/**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.startsWith("/api/")) apiCalls += 1;
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

/**
 * @scenario "Build all configured documentation"
 * @scenario "Publish only the configured API inventory"
 */
await it("publishes exactly the configured inventory and its supporting files", async () => {
  await assertBuild({ outDir });
});

/**
 * @scenario "Read the three key pages in both themes and viewport sizes"
 * @scenario "Inspect an API request before sending"
 */
await it("renders and operates the key pages at 1440 and 390 in light and dark", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1440, 390])
        for (const mode of ["light", "dark"]) {
          await checkVariant({ browser, base, width, mode });
        }
      console.log(`Screenshots: ${screenshots}`);
    },
  });
});

/** @scenario "Start with a coding agent" */
await it("selects a coding agent and copies the complete authored setup prompt", async () => {
  const prompt = await tracingPrompt({ outDir });
  await withReader({ outDir, run: ({ page, base }) => assertAgentSetup({ page, base, prompt }) });
});

/** @scenario "Keep clipboard controls unavailable before hydration" */
await it("disables clipboard actions until their browser handlers are ready", async () => {
  await withPreviewBrowser({ outDir, run: (context) => assertClipboardReadiness(context) });
});

/** @scenario "Copy a skill prompt" */
await it("copies the full prompt from the generated skill card", async () => {
  const prompt = await tracingPrompt({ outDir });
  await withReader({ outDir, run: ({ page, base }) => assertSkillCopy({ page, base, prompt }) });
});

/** @scenario "Navigate on a small screen" */
await it("scrolls the mobile page tree and restores focus when dismissed", async () => {
  await withReader({ outDir, run: (context) => assertMobileNavigation(context) });
});

/** @scenario "Recover from unavailable browser capabilities" */
await it("reports denied clipboard access and retries unavailable media", async () => {
  await withReader({ outDir, run: (context) => assertCapabilityErrors(context) });
});

/** @scenario "Read diagrams without JavaScript" */
await it("publishes both diagram themes and usable source without JavaScript", async () => {
  await withPreviewBrowser({ outDir, run: (context) => assertStaticDiagrams(context) });
});

/** @scenario "Recover from an unknown route" */
await it("offers working search on an unknown route", async () => {
  await withReader({
    outDir,
    run: async ({ page, base }) => {
      const response = await page.goto(`${base}nonexistent-docs-smoke-route`);
      assert.equal(response.status(), 404);
      await page.locator("[data-docs-not-found][data-ready]").waitFor({ state: "attached" });
      await page.locator("[data-nf-search]").click();
      await page.getByRole("searchbox").fill("traces");
      const result = page.locator("#docs-search-results a").first();
      await result.waitFor();
      await result.click();
      await page.waitForURL((url) => !url.pathname.includes("nonexistent-docs-smoke-route"));
      assert.ok((await page.locator("h1").textContent()).trim().length > 0);
    },
  });
});

/** @scenario "Show the scene and closest pages for a missing address" */
await it("acts out a missing address in its section's scene and links its closest pages", async () => {
  await withReader({
    outDir,
    run: async ({ page, base }) => {
      for (const [address, scene, first] of [
        ["api-reference/traces/serch", "engineering", "/api-reference/traces/search"],
        ["evaluations/llm-as-judge", "product", "/evaluations/experiments/ui/llm-as-a-judge"],
      ]) {
        const response = await page.goto(`${base}${address}`);
        assert.equal(response.status(), 404, address);
        const root = page.locator("[data-docs-not-found][data-ready]");
        await root.waitFor({ state: "attached" });
        assert.equal(await root.getAttribute("data-scene"), scene, address);
        assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex");
        assert.equal(await page.locator("h1").count(), 1, address);
        const scenery = scene === "engineering" ? ".docs-nf-term" : ".docs-nf-trace";
        assert.equal(await page.locator(scenery).count(), 1, address);
        const pick = new URL(await page.locator('[data-nf-pick="1"]').getAttribute("href"), base);
        assert.equal(pick.pathname, first, address);
        assert.ok(await page.locator("[data-nf-rail-matches] a").count(), address);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          address,
        );
        await page.keyboard.press("1");
        await page.waitForURL((url) => url.pathname === first);
      }
    },
  });
});

/** @scenario "Draw the mark until the scene is chosen" */
await it("draws the mark at first paint, then shows the castle when the island is late", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        /* Hold every script request: the inline theme script still runs, the island never does. */
        await page.route("**/*", (route) =>
          route.request().resourceType() === "script" ? undefined : route.continue(),
        );
        await page.goto(`${base}nonexistent-docs-intro-route`, { waitUntil: "commit" });
        const intro = page.locator("[data-nf-intro] svg");
        await intro.waitFor({ state: "visible" });
        const stage = page.locator("[data-nf-stage]");
        assert.equal(await stage.evaluate((node) => getComputedStyle(node).opacity), "0");
        await page.waitForTimeout(1400);
        assert.equal(await intro.isVisible(), false);
        assert.equal(await stage.evaluate((node) => getComputedStyle(node).opacity), "1");
        assert.equal(await page.locator(".docs-castle").isVisible(), true);
      } finally {
        await context.close();
      }
      const still = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await still.newPage();
        await page.goto(`${base}nonexistent-docs-intro-route`);
        assert.equal(await page.locator("[data-nf-intro]").isVisible(), false);
        assert.equal(await page.locator(".docs-castle").isVisible(), true);
      } finally {
        await still.close();
      }
    },
  });
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
      /* Pattern sources and moved exports are host rules, with no static page. */
      if (/[:*]|\.(md|claude|agent)$/.test(source)) continue;
      const page = await readFile(path.join(outDir, source.slice(1), "index.html"), "utf8");
      if (!page.includes('name="robots" content="noindex"')) continue;
      assert.ok(page.includes(`url=${destination.replaceAll("&", "&amp;")}"`), source);
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
