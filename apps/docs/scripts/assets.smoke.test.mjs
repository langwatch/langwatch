import assert from "node:assert/strict";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({ options: { "out-dir": { type: "string" } } });
const outDir = path.resolve(values["out-dir"] ?? "dist");
const FONT_DELAY_MS = 1200;

/** Layout shift summed over a load whose web fonts (and, if asked, scripts) arrive late. */
async function shiftWithLateFonts({ browser, base, slug, width, lateScripts = false }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.docsShift = 0;
      window.docsShifted = [];
      const nameOf = (node) =>
        node ? `${node.nodeName.toLowerCase()}.${String(node.className).slice(0, 60)}` : "?";
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          window.docsShift += entry.value;
          const moved = entry.sources.map((source) => {
            const [from, to] = [source.previousRect, source.currentRect];
            return `${nameOf(source.node)} y${Math.round(from.y)}->${Math.round(to.y)} h${Math.round(from.height)}->${Math.round(to.height)}`;
          });
          window.docsShifted.push(`${entry.value.toFixed(4)}: ${moved.join(", ")}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.route(lateScripts ? /\.(woff2|js)(\?|$)/ : "**/*.woff2", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
      await route.continue();
    });
    await page.goto(base + slug, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    return await page.evaluate(() => ({
      shift: window.docsShift,
      shifted: window.docsShifted,
      loaded: [...document.fonts]
        .filter((font) => font.status === "loaded")
        .map((font) => font.family),
    }));
  } finally {
    await context.close();
  }
}

/** @scenario "Keep text in place while the web fonts load" */
await it("keeps a section index and a guide in place when the fonts swap in", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const slug of ["ai-governance/ingestion-sources", "integration/quick-start"]) {
        for (const width of [1440, 390]) {
          const { shift, shifted, loaded } = await shiftWithLateFonts({
            browser,
            base,
            slug,
            width,
          });
          assert.ok(loaded.includes("Inter"), `${slug} at ${width}px swaps in the web font`);
          assert.ok(
            shift <= 0.01,
            `${slug} at ${width}px shifts ${shift.toFixed(4)} on the font swap: ${shifted.join("; ")}`,
          );
        }
      }
    },
  });
});

/** @scenario "Keep an API reference in place while the page starts" */
await it("keeps the endpoint reference in place when the examples settle", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const slug = "api-reference/traces/get-trace";
      for (const width of [1440, 1280, 390]) {
        const late = { browser, base, slug, width, lateScripts: true };
        const { shift, shifted } = await shiftWithLateFonts(late);
        const detail = shifted.join("; ");
        assert.ok(
          shift <= 0.01,
          `${slug} at ${width}px shifts ${shift.toFixed(4)} on load: ${detail}`,
        );
      }
    },
  });
});

/** @scenario "Fetch only the fonts an English page draws" */
await it("preloads the body and title fonts and never fetches extended Latin", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        try {
          const page = await context.newPage();
          const fonts = [];
          page.on("request", (request) => {
            if (request.url().endsWith(".woff2")) fonts.push(path.basename(request.url()));
          });
          for (const slug of [
            "introduction",
            "integration/quick-start",
            "ai-governance/ingestion-sources",
          ]) {
            await page.goto(base + slug, { waitUntil: "load" });
            await page.evaluate(() => document.fonts.ready);
            const preloaded = await page.evaluate(() =>
              performance
                .getEntriesByType("resource")
                .filter((entry) => entry.name.endsWith(".woff2") && entry.initiatorType === "link")
                .map((entry) => entry.name.split("/").pop()),
            );
            assert.deepEqual(preloaded.toSorted(), [
              "Inter-Variable-latin.woff2",
              "Sentient-Regular.woff2",
            ]);
          }
          assert.deepEqual(
            fonts.filter((font) => font.includes("latin-ext")),
            [],
            `no extended-Latin font at ${width}px`,
          );
        } finally {
          await context.close();
        }
      }
    },
  });
});

/** @scenario "Keep the agent carousel's faded names out of the contrast and reading order" */
await it("draws the agent wheel's names from the stylesheet only", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(base + "integration/quick-start", { waitUntil: "load" });
        const names = await page
          .locator(".docs-agent-launcher .docs-agent-name")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              text: node.textContent,
              hidden: node.closest('[aria-hidden="true"]') !== null,
              drawn: getComputedStyle(node, "::before").content,
              distance: node.getAttribute("data-distance"),
            })),
          );
        assert.equal(names.length, 5);
        for (const name of names) {
          assert.equal(name.text, "");
          assert.ok(name.hidden);
        }
        assert.equal(names.find((name) => name.distance === "0")?.drawn, '"claude"');
      } finally {
        await context.close();
      }
    },
  });
});
