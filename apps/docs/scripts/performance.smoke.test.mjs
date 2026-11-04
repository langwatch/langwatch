import assert from "node:assert/strict";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";
import { INTERACTION_BUDGETS, interactionSizes, readManifest } from "./interaction-sizes.mjs";

const { values } = parseArgs({ options: { "out-dir": { type: "string" } } });
const outDir = path.resolve(values["out-dir"] ?? "dist");

/** @scenario "Read a styled guide without JavaScript" */
await it("renders styled content and code without JavaScript", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        for (const slug of ["integration/quick-start", "api-reference/traces/get-trace"]) {
          await page.goto(base + slug);
          assert.ok(await page.locator("h1").isVisible());
          assert.ok(
            await page
              .locator(".docs-layout")
              .evaluate((node) => getComputedStyle(node).display === "grid"),
          );
          assert.equal(await page.locator("style[data-emotion]").count(), 0);
          assert.ok(await page.locator("link[data-docs-style]").count());
          const examples = page.locator(".docs-examples");
          if ((await examples.count()) && (await examples.getAttribute("open")) === null)
            await examples.locator("summary").click();
          await page.locator(".docs-code-region").first().waitFor({ state: "visible" });
        }
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Navigate without replacing the shell" */
await it("swaps pages, preserves the header and restores history/focus", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "introduction");
        const originalHeading = await page.locator("h1").textContent();
        await page.locator("header").evaluate((node) => {
          node.dataset.navigationTest = "preserved";
        });
        const link = page.locator('#content a[href="/integration/quick-start"]').first();
        await link.click();
        await page.waitForURL("**/integration/quick-start");
        assert.equal(
          await page.locator("header").getAttribute("data-navigation-test"),
          "preserved",
        );
        assert.match(await page.title(), /Quick Start/i);
        assert.equal(
          await page.locator("#content").evaluate((node) => node === document.activeElement),
          true,
        );
        assert.match(await page.locator("#docs-navigation-status").textContent(), /Quick Start/i);
        await page.goBack();
        await page.waitForURL("**/introduction");
        await page.locator("h1").filter({ hasText: originalHeading }).waitFor();
        assert.equal(
          await page.locator("header").getAttribute("data-navigation-test"),
          "preserved",
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Prefetch a likely destination" */
await it("fetches hovered HTML once and reuses it for navigation", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "introduction");
        await page.locator('script[data-island="reading"]').waitFor({ state: "attached" });
        const link = page.locator('a[href="/api-reference/introduction"]').first();
        let requests = 0;
        page.on("request", (request) => {
          if (request.url() === base + "api-reference/introduction") requests++;
        });
        await Promise.all([
          page.waitForResponse(base + "api-reference/introduction"),
          link.hover(),
        ]);
        assert.match(page.url(), /introduction$/);
        await link.click();
        await page.waitForURL("**/api-reference/introduction");
        assert.equal(requests, 1);
      } finally {
        await page.close();
      }
    },
  });
});

/** Counts speculative HTML fetches (not navigations) and the most in flight at once. */
function watchPageFetches({ page }) {
  const fetches = { started: 0, active: 0, peak: 0 };
  const isPageFetch = (request) =>
    request.resourceType() === "fetch" && request.headers().accept === "text/html";
  page.on("request", (request) => {
    if (!isPageFetch(request)) return;
    fetches.started++;
    fetches.active++;
    fetches.peak = Math.max(fetches.peak, fetches.active);
  });
  for (const event of ["requestfinished", "requestfailed"])
    page.on(event, (request) => {
      if (isPageFetch(request)) fetches.active--;
    });
  return fetches;
}

/** @scenario "Hold back speculative prefetch" */
await it("skips speculative fetches under Save-Data, waits for hover intent and caps concurrency", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const saving = await browser.newContext();
      try {
        const page = await saving.newPage();
        await page.addInitScript(() =>
          Object.defineProperty(navigator, "connection", { value: { saveData: true } }),
        );
        const fetches = watchPageFetches({ page });
        await page.goto(base + "introduction");
        await page.locator('script[data-island="reading"]').waitFor({ state: "attached" });
        const link = page.locator('#content a[href="/integration/quick-start"]').first();
        await link.hover();
        await link.focus();
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(500);
        assert.equal(fetches.started, 0);
        await link.click();
        await page.waitForURL("**/integration/quick-start");
      } finally {
        await saving.close();
      }

      const reader = await browser.newContext();
      try {
        const page = await reader.newPage();
        await page.route(
          (url) => !path.extname(url.pathname),
          async (route) => {
            const speculative = route.request().resourceType() === "fetch";
            if (speculative) await new Promise((resolve) => setTimeout(resolve, 1500));
            await route.fallback();
          },
        );
        await page.goto(base + "introduction");
        await page.locator('script[data-island="reading"]').waitFor({ state: "attached" });
        await page.waitForTimeout(2000);
        const fetches = watchPageFetches({ page });
        await page.evaluate(() => {
          const link = document.querySelector('#content a[href="/integration/quick-start"]');
          link?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
          link?.dispatchEvent(
            new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
          );
        });
        await page.waitForTimeout(300);
        assert.equal(fetches.started, 0, "a passing pointer must not prefetch");
        await page.evaluate(() => {
          const links = [...document.querySelectorAll("nav a[href^='/']")].slice(0, 8);
          for (const link of links)
            link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        });
        await page.waitForTimeout(300);
        assert.ok(fetches.started >= 1, "a focused link prefetches");
        assert.ok(
          fetches.peak <= 2,
          `at most two speculative fetches at once, saw ${fetches.peak}`,
        );
      } finally {
        await reader.close();
      }
    },
  });
});

const CLIP_PAGE = "prompt-management/prompt-playground";
const CLIP_SOURCE =
  /\/media\/videos\/(add-variable|prompt-messages-editor|prompt-split-view)\.([0-9a-f]{12}\.)?(webm|mp4)$/;

/** @scenario "Play an instructional clip in place of an animated GIF" */
await it("serves silent clips with posters that play only while visible and allowed", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const noScript = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await noScript.newPage();
        await page.goto(base + CLIP_PAGE);
        assert.equal(await page.locator('img[src$=".gif"]').count(), 0);
        const clips = await page.locator("video[data-docs-clip]").evaluateAll((videos) =>
          videos.map((video) => ({
            poster: video.getAttribute("poster"),
            controls: video.controls,
            muted: video.muted,
            preload: video.preload,
            label: video.getAttribute("aria-label"),
            sized: Boolean(video.getAttribute("width") && video.getAttribute("height")),
            sources: [...video.querySelectorAll("source")].map((source) => source.type),
          })),
        );
        assert.equal(clips.length, 3);
        for (const clip of clips) {
          assert.match(clip.poster ?? "", /\/media\/posters\/.+\.webp$/);
          assert.ok(clip.label, "each clip keeps its alternative text");
          assert.deepEqual(
            [clip.controls, clip.muted, clip.preload, clip.sized],
            [true, true, "none", true],
          );
          assert.deepEqual(
            clip.sources.map((type) => type.split(";")[0]),
            ["video/webm", "video/mp4"],
          );
          assert.ok(
            clip.sources.every((type) => type.includes("codecs=")),
            "codecs named",
          );
        }
      } finally {
        await noScript.close();
      }

      const still = await browser.newContext({ reducedMotion: "reduce" });
      try {
        const page = await still.newPage();
        let videoRequests = 0;
        page.on("request", (request) => {
          if (CLIP_SOURCE.test(request.url())) videoRequests++;
        });
        await page.goto(base + CLIP_PAGE);
        const clip = page.locator("video[data-docs-clip]").first();
        await clip.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);
        assert.equal(await clip.evaluate((video) => video.paused), true);
        assert.equal(videoRequests, 0, "reduced motion keeps clips on their posters");
      } finally {
        await still.close();
      }

      const moving = await browser.newContext({ reducedMotion: "no-preference" });
      try {
        const page = await moving.newPage();
        await page.goto(base + CLIP_PAGE);
        await page.locator('script[data-island="media"]').waitFor({ state: "attached" });
        const clip = page.locator("video[data-docs-clip]").first();
        const playing = () => !document.querySelector("video[data-docs-clip]")?.paused;
        const scrollPast = () =>
          window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
        await clip.scrollIntoViewIfNeeded();
        await page.waitForFunction(playing);
        await page.evaluate(scrollPast);
        await page.waitForFunction(() => document.querySelector("video[data-docs-clip]")?.paused);
        await clip.scrollIntoViewIfNeeded();
        await page.waitForFunction(playing);
        await clip.evaluate((video) => video.pause());
        await page.evaluate(scrollPast);
        await clip.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        assert.equal(await clip.evaluate((video) => video.paused), true, "a reader's pause sticks");
      } finally {
        await moving.close();
      }

      const failing = await browser.newContext({ reducedMotion: "no-preference" });
      try {
        const page = await failing.newPage();
        await page.route(/\/media\/videos\/.+\.(webm|mp4)$/, (route) =>
          route.fulfill({ status: 404 }),
        );
        await page.goto(base + CLIP_PAGE);
        await page.locator('script[data-island="media"]').waitFor({ state: "attached" });
        const clip = page.locator("video[data-docs-clip]").first();
        await clip.scrollIntoViewIfNeeded();
        await page.getByRole("alert").filter({ hasText: "could not load" }).first().waitFor();
        assert.match((await clip.getAttribute("poster")) ?? "", /\.webp$/);
      } finally {
        await failing.close();
      }
    },
  });
});

/** @scenario "Send a request from a lazy playground" */
await it("loads the playground on demand and sends an isolated request", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        const page = await context.newPage();
        const calls = [];
        /* The session frame loads from the app too; only requests under /api are counted. */
        await page.route("https://app.langwatch.ai/**", async (route) => {
          const { pathname } = new URL(route.request().url());
          if (!pathname.startsWith("/api/")) return route.abort();
          calls.push({
            url: route.request().url(),
            method: route.request().method(),
            key: route.request().headers()["x-auth-token"],
          });
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ trace_id: "test-trace", result: "Request received" }),
          });
        });
        await page.goto(base + "api-reference/traces/get-trace");
        assert.equal(await page.locator('script[data-island="playground"]').count(), 0);
        await page.locator("#try-it-button").click();
        await page.locator("#pg-auth").fill("test-only-key");
        await page.locator("#pg-path-traceId").fill("test-trace");
        await page.locator("#pg-send").click();
        await page.getByLabel("Response body").filter({ hasText: "Request received" }).waitFor();
        assert.deepEqual(calls, [
          {
            url: "https://app.langwatch.ai/api/v1/traces/test-trace",
            method: "GET",
            key: "test-only-key",
          },
        ]);
        const examples = page.locator(".docs-examples");
        if (!(await examples.getAttribute("open"))) await examples.locator("summary").click();
        await page
          .getByRole("region", { name: "Request example", exact: true })
          .getByRole("button", { name: "Copy code", exact: true })
          .click();
        await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(copied, /LANGWATCH_API_KEY/);
        assert.ok(!copied.includes("test-only-key"));
        await page.locator('a[href="/api-reference/introduction"]').first().click();
        await page.waitForURL("**/api-reference/introduction");
        await page.goBack();
        await page.locator("#try-it-button").click();
        assert.equal(await page.locator("#pg-auth").inputValue(), "");
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Use a static MDX disclosure" */
await it("expands and collapses server-rendered MDX accordions", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "coding-agents/claude-code");
        const trigger = page.locator('[data-scope="accordion"][data-part="item-trigger"]').first();
        await trigger.focus();
        const initiallyOpen = await trigger.getAttribute("aria-expanded");
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (before) =>
            document
              .querySelector('[data-scope="accordion"][data-part="item-trigger"]')
              ?.getAttribute("aria-expanded") !== before,
          initiallyOpen,
        );
        const panel = page.locator('[data-scope="accordion"][data-part="item-content"]').first();
        await panel.waitFor({ state: initiallyOpen === "true" ? "hidden" : "visible" });
        assert.equal(await panel.isVisible(), initiallyOpen !== "true");
        await page.keyboard.press("Enter");
        assert.equal(await trigger.getAttribute("aria-expanded"), initiallyOpen);
        assert.equal(
          await page
            .locator('script[data-island="playground"],script[data-island="search"]')
            .count(),
          0,
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Keep dark mode and island styles on a page with inlined styles" */
await it("styles a page, dark mode, search and navigation from inlined styles", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const sample = (page) =>
        page.locator(".docs-layout").evaluate((layout) =>
          [layout, ...layout.querySelectorAll("*")].slice(0, 400).map((node) => {
            const style = getComputedStyle(node);
            return [style.display, style.color, style.backgroundColor, style.fontSize].join();
          }),
        );
      const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await blocked.newPage();
        await page.route(/\/assets\/docs-[0-9a-f]+\.css$/, (route) => route.abort());
        const response = await page.goto(base + "integration/quick-start");
        const html = await response.text();
        assert.match(html, /<style>@layer /);
        assert.doesNotMatch(
          html.replace(/<noscript>[\s\S]*?<\/noscript>/g, ""),
          /<link(?![^>]*media="print")[^>]*rel="stylesheet"/,
        );
        assert.equal(
          await page.locator(".docs-layout").evaluate((node) => getComputedStyle(node).display),
          "grid",
        );
        const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await page.getByRole("button", { name: "Switch color theme" }).first().click();
        await page.waitForFunction(
          (before) =>
            document.documentElement.classList.contains("dark") &&
            getComputedStyle(document.body).backgroundColor !== before,
          light,
        );
        await page.keyboard.press("Escape");
        await page.keyboard.press("Control+k");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.notEqual(
          await dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
          "rgba(0, 0, 0, 0)",
        );
      } finally {
        await blocked.close();
      }
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(base + "api-reference/traces/get-trace");
        const fresh = await sample(page);
        await page.goto(base + "integration/quick-start", { waitUntil: "networkidle" });
        await page.locator("#content").evaluate((content) => {
          const link = document.createElement("a");
          link.href = "/api-reference/traces/get-trace";
          link.id = "navigation-test";
          link.textContent = "Get trace";
          content.prepend(link);
        });
        await page.locator("#navigation-test").click();
        await page.waitForURL("**/api-reference/traces/get-trace");
        await page.locator("h1").waitFor();
        assert.deepEqual(await sample(page), fresh);
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Follow the reader's dark preference without JavaScript" */
await it("follows a dark colour scheme without JavaScript and costs scripted readers nothing", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const slugs = ["introduction", "integration/quick-start", "api-reference/traces/get-trace"];
      for (const [colorScheme, background] of [
        ["dark", "rgb(20, 20, 23)"],
        ["light", "rgb(255, 255, 255)"],
      ]) {
        const context = await browser.newContext({ javaScriptEnabled: false, colorScheme });
        try {
          const page = await context.newPage();
          for (const slug of slugs) {
            await page.goto(base + slug, { waitUntil: "load" });
            assert.equal(
              await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
              background,
              `${slug} ${colorScheme}`,
            );
          }
          await page.goto(base + "integration/quick-start", { waitUntil: "load" });
          const visible = (selector) =>
            page
              .locator(selector)
              .first()
              .evaluate((node) => getComputedStyle(node).display);
          if (await page.locator(".docs-dark-only").count())
            assert.equal((await visible(".docs-dark-only")) === "none", colorScheme === "light");
        } finally {
          await context.close();
        }
      }
      const context = await browser.newContext({ colorScheme: "dark" });
      try {
        const page = await context.newPage();
        const styles = [];
        page.on("request", (request) => {
          if (request.url().endsWith(".css")) styles.push(request.url());
        });
        await page.goto(base + "integration/quick-start", { waitUntil: "networkidle" });
        assert.equal(styles.filter((url) => url.includes("/docs-dark-")).length, 0);
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
          "rgb(20, 20, 23)",
        );
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Answer a first click on search, a context menu or the playground on a small download" */
await it("keeps each interactive island's first download within its budget", async () => {
  const manifest = await readManifest({ directory: outDir });
  const sizes = await interactionSizes({ directory: outDir, manifest });
  for (const [field, limit] of Object.entries(INTERACTION_BUDGETS))
    assert.ok(sizes[field] <= limit, `${field} is ${sizes[field]} gzip bytes, over ${limit}`);
});
