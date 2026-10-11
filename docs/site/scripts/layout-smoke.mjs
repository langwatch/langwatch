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

async function assertDocumentFlow({ page, desktop }) {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector(".docs-layout");
    const footer = document.querySelector(".docs-site-footer");
    const rail = document.querySelector(".docs-left-rail");
    const header = document.querySelector("header");
    const bounds = (node) => node.getBoundingClientRect();
    const scrollBoxes = [...panel.querySelectorAll("*")]
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          /auto|scroll/.test(style.overflowY) &&
          node.clientHeight > 0 &&
          node.scrollHeight > node.clientHeight + 2
        );
      })
      .map((node) => node.className);
    return {
      footerOutside: !panel.contains(footer),
      footerTop: bounds(footer).top,
      panelBottom: bounds(panel).bottom,
      footerWidth: bounds(footer).width,
      railBottom: bounds(rail).bottom,
      railHeight: bounds(rail).height,
      headerHeight: bounds(header).height,
      viewport: innerHeight,
      railPosition: getComputedStyle(rail).position,
      scrollBoxes,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(geometry.footerOutside, true);
  assert.ok(geometry.footerTop >= geometry.panelBottom);
  assert.equal(geometry.footerWidth, page.viewportSize().width);
  assert.deepEqual(geometry.scrollBoxes, []);
  assert.equal(geometry.overflow, false);
  if (desktop) {
    assert.ok(geometry.railBottom <= geometry.panelBottom + 1);
    if (geometry.railHeight > geometry.viewport - geometry.headerHeight)
      assert.equal(geometry.railPosition, "relative");
  }
}
async function capture({ page, name, width, mode }) {
  await page.screenshot({ path: path.join(screenshots, `${name}-${width}-${mode}.png`) });
}
async function reviewPage({ page, base, slug, width, mode }) {
  await page.goto(base + slug);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Boolean(document.querySelector('[data-island="toc"]')));
  const desktop = width >= 1024;
  if (desktop) {
    await page.waitForFunction(() => {
      const active = document.querySelector('.docs-left-rail [aria-current="page"]');
      return !active || active.getBoundingClientRect().bottom <= innerHeight;
    });
    assert.equal(
      await page
        .locator('.docs-left-rail [aria-current="page"]')
        .evaluate((node) => getComputedStyle(node).boxShadow),
      "none",
    );
  }
  await page.evaluate(() => scrollTo(0, 0));
  const header = await page.locator("header").boundingBox();
  const panel = await page.locator(".docs-layout").boundingBox();
  assert.ok(panel.y - header.y - header.height >= 19);
  assert.ok(
    await page
      .locator(".docs-layout")
      .evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius) >= 12),
  );
  const name = slug.replaceAll("/", "_");
  await capture({ page, name: `${name}-top`, width, mode });
  await assertDocumentFlow({ page, desktop });
  await page.evaluate(() => scrollTo(0, 700));
  await assertDocumentFlow({ page, desktop });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await assertDocumentFlow({ page, desktop });
  await capture({ page, name: `${name}-bottom`, width, mode });
}

/** @scenario "Scroll a long API section naturally" */
await it("uses one document scroll and keeps the footer below both article and navigation", async () => {
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
            for (const slug of ["api-reference/introduction", "integration/quick-start", "support"])
              await reviewPage({ page, base, slug, width, mode });
          } finally {
            await context.close();
          }
        }
      }
    },
  });
});
