import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: { "out-dir": { type: "string" }, screenshots: { type: "string" } },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = path.resolve(values.screenshots ?? "layout-shots");
await mkdir(screenshots, { recursive: true });

/** @scenario "Scroll a long API section naturally" */
await it("keeps the active page and section links visible in a viewport-sticky sidebar", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1280, 1440, 1670, 390]) {
        for (const mode of ["light", "dark"]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: mode,
            reducedMotion: "reduce",
          });
          try {
            const page = await context.newPage();
            await page.goto(base + "api-reference/introduction");
            await page.evaluate(() => document.fonts.ready);
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            );
            if (width > 1000) {
              const sidebar = page.locator(".docs-left-rail");
              assert.equal(await sidebar.evaluate((node) => node.scrollTop), 0);
              const active = sidebar.locator('[aria-current="page"]');
              assert.equal((await active.textContent()).trim(), "Introduction");
              assert.ok((await active.boundingBox()).y < 1000);
              assert.ok(
                await sidebar.getByRole("link", { name: "Platform", exact: true }).isVisible(),
              );
              const header = await page.locator("header").boundingBox();
              const panel = await page.locator(".docs-layout").boundingBox();
              assert.ok(Math.abs(panel.y - header.y - header.height) < 2);
              const names = await sidebar.locator(".docs-nav-label").evaluateAll((nodes) =>
                nodes.map((node) => ({
                  height: node.getBoundingClientRect().height,
                  line: parseFloat(getComputedStyle(node).lineHeight),
                })),
              );
              assert.ok(names.every(({ height, line }) => height <= line * 2 + 1));
            }
            await page.screenshot({
              path: path.join(screenshots, `api-introduction-${width}-${mode}.png`),
            });
            await page.evaluate(() => window.scrollTo(0, 650));
            if (width > 1000) {
              const top = await page
                .locator(".docs-left-rail")
                .evaluate((node) => node.getBoundingClientRect().top);
              const height = await page
                .locator("header")
                .evaluate((node) => node.getBoundingClientRect().height);
              assert.ok(Math.abs(top - height) < 2);
              assert.equal(
                await page.locator(".docs-left-rail").evaluate((node) => node.scrollTop),
                0,
              );
            }
            await page.screenshot({
              path: path.join(screenshots, `api-introduction-scrolled-${width}-${mode}.png`),
            });
          } finally {
            await context.close();
          }
        }
      }
    },
  });
});
