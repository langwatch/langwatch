import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    screenshots: { type: "string" },
  },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = path.resolve(values.screenshots ?? "news-shots");
await mkdir(screenshots, { recursive: true });

async function assertStrip({ page, base, width, mode }) {
  await page.goto(base + "integration/quick-start");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Boolean(document.querySelector("script[data-island=toc]")));
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  const strip = page.getByRole("complementary", { name: "Latest release" });
  const version = await strip.locator(".docs-release-version").textContent();
  assert.match(version, /^v\d+\.\d+\.\d+$/);
  assert.match(await strip.locator("time").getAttribute("datetime"), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok((await strip.locator(".docs-release-summary").textContent()).length > 10);
  assert.ok((await strip.boundingBox()).height <= 40);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await strip.evaluate((node) => getComputedStyle(node).animationName), "none");
  await strip.hover();
  await page.screenshot({
    animations: "disabled",
    path: path.join(screenshots, `after-${width}-${mode}.png`),
  });
  const href = await strip.locator("a").getAttribute("href");
  await strip.locator("a").click();
  await page.waitForURL((url) => url.pathname + url.hash === href);
  await page.getByRole("heading", { name: `Release ${version}` }).waitFor();
  assert.ok(await page.getByRole("heading", { name: "Versioning" }).count());
  return strip.getAttribute("data-docs-banner");
}

async function dismissRelease({ page, base, release }) {
  const strip = page.getByRole("complementary", { name: "Latest release" });
  await page.getByRole("button", { name: "Dismiss announcement" }).click();
  await strip.waitFor({ state: "detached" });
  await page.goto(base + "api-reference/introduction");
  assert.equal(await strip.count(), 0);
  await page.reload();
  assert.equal(await strip.count(), 0);
  await page.evaluate((id) => {
    localStorage.removeItem(`lw-docs:${id}`);
    localStorage.setItem("lw-docs:release:0.0.0", "dismissed");
  }, release);
  await page.reload();
  await strip.waitFor();
}

/** @scenario "Read and dismiss a release update" */
await it("renders real notes and remembers dismissal by release at desktop and phone widths", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1440, 390]) {
        for (const mode of ["light", "dark"]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: mode,
            reducedMotion: width === 390 ? "reduce" : "no-preference",
          });
          try {
            const page = await context.newPage();
            const release = await assertStrip({ page, base, width, mode });
            await dismissRelease({ page, base, release });
          } finally {
            await context.close();
          }
        }
      }
    },
  });
});

/** @scenario "Read and dismiss a release update" */
await it("keeps releases readable without scripts and can dismiss when storage is denied", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const staticContext = await browser.newContext({ javaScriptEnabled: false });
      const deniedContext = await browser.newContext();
      try {
        const staticPage = await staticContext.newPage();
        await staticPage.goto(base + "self-hosting/releases");
        const strip = staticPage.getByRole("complementary", { name: "Latest release" });
        const version = await strip.locator(".docs-release-version").textContent();
        await staticPage.getByRole("heading", { name: `Release ${version}` }).waitFor();
        await deniedContext.addInitScript(() => {
          Storage.prototype.getItem = () => {
            throw new Error("Storage denied");
          };
          Storage.prototype.setItem = () => {
            throw new Error("Storage denied");
          };
        });
        const page = await deniedContext.newPage();
        await page.goto(base + "support");
        await page.getByRole("button", { name: "Dismiss announcement" }).click();
        await page
          .getByRole("complementary", { name: "Latest release" })
          .waitFor({ state: "detached" });
      } finally {
        await staticContext.close();
        await deniedContext.close();
      }
    },
  });
});

/** @scenario "Find contextual agent setup" */
await it("links from every guide sidebar to the coding-agent quickstart", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      try {
        await page.goto(base + "integration/quick-start");
        await page
          .locator(".docs-left-rail .docs-agent-launcher")
          .getByRole("link", { name: "Setup guide" })
          .click();
        await page.waitForURL(base + "coding-agents/quickstart");
        assert.equal(await page.locator(".docs-left-rail .docs-agent-launcher").count(), 1);
        await page.goto(base + "introduction");
        assert.equal(await page.locator(".docs-left-rail .docs-agent-launcher").count(), 1);
      } finally {
        await page.close();
      }
    },
  });
});
