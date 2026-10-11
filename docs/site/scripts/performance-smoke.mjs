import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

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
          assert.ok(await page.locator(".docs-code-region").first().isVisible());
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

/** @scenario "Update an offline cache safely" */
await it("activates a new cache version and provides offline pages without caching API requests", async () => {
  const workerPath = path.join(outDir, "sw.js");
  const original = await readFile(workerPath, "utf8");
  try {
    await withPreviewBrowser({
      outDir,
      run: async ({ browser, base }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
          await page.goto(base + "introduction");
          await page.evaluate(() => navigator.serviceWorker.ready);
          await page.reload();
          await page.evaluate(async () => {
            await fetch("/integration/quick-start", { headers: { Accept: "text/html" } });
          });
          await page.waitForFunction(async () =>
            Boolean(await caches.match("/integration/quick-start")),
          );
          await context.setOffline(true);
          await page.goto(base + "integration/quick-start");
          assert.match(await page.title(), /Quick Start/i);
          await page.goto(base + "never-cached-offline-page");
          assert.equal(await page.locator("h1").textContent(), "You are offline");
          await context.setOffline(false);
          await page.goto(base + "introduction");
          const oldKeys = await page.evaluate(() => caches.keys());
          await writeFile(
            workerPath,
            original.replace(/const VERSION = "[^"]+";/, 'const VERSION = "update-test";'),
          );
          await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update();
          });
          await page.waitForFunction(async () =>
            (await caches.keys()).includes("lw-docs-static-update-test"),
          );
          await page.waitForFunction(
            async (keys) => !(await caches.keys()).some((key) => keys.includes(key)),
            oldKeys,
          );
          await page.reload();
          await page.evaluate(async () => {
            await fetch("/api/credential-test", { headers: { "X-Auth-Token": "test-only" } });
            await fetch("/search-index.json", { headers: { "X-Auth-Token": "test-only" } });
            await fetch("/search-index.json", { headers: { Authorization: "Bearer test-only" } });
          });
          const paths = await page.evaluate(async () => {
            const keys = await caches.keys();
            const requests = await Promise.all(
              keys.map(async (key) => (await caches.open(key)).keys()),
            );
            return requests.flat().map((request) => request.url);
          });
          assert.ok(
            paths.every((url) => !url.includes("/api/") && !url.endsWith("/search-index.json")),
          );
        } finally {
          await context.close();
        }
      },
    });
  } finally {
    await writeFile(workerPath, original);
  }
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
        await page.route("https://app.langwatch.ai/**", async (route) => {
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
