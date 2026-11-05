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
const screenshots = path.resolve(
  values.screenshots ?? process.env.TMPDIR ?? "node_modules/.cache/docs-ui-shots",
);
await mkdir(screenshots, { recursive: true });

/** @scenario "Choose and remember a code language from code tabs" */
await it("switches filenames and copied code together and remembers the language", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
      try {
        await page.goto(base + "integration/mcp");
        const groups = page.locator('[data-docs-preference="sdk-language"]');
        const before = groups
          .filter({ has: page.locator("[data-docs-code-title]", { hasText: "chat.py" }) })
          .first();
        await before
          .getByRole("button", { name: "Copy code", exact: true })
          .waitFor({ state: "visible" });
        await before.getByRole("tab", { name: "TypeScript", exact: true }).click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("[data-docs-code-title]")].filter(
              (n) => n.textContent === "chat.ts",
            ).length === 2,
        );
        assert.equal(
          await page.getByRole("combobox", { name: "Preferred code language" }).count(),
          0,
        );
        const frame = groups
          .filter({ has: page.locator("[data-docs-code-title]", { hasText: "chat.ts" }) })
          .first();
        await frame.getByRole("button", { name: "Copy code", exact: true }).click();
        await page.waitForFunction(() =>
          navigator.clipboard.readText().then((text) => text.includes("import { OpenAI }")),
        );
        assert.match(
          await page.evaluate(() => navigator.clipboard.readText()),
          /async function chat/,
        );
        assert.doesNotMatch(
          await page.evaluate(() => navigator.clipboard.readText()),
          /from openai import/,
        );
        await page.reload();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("[data-docs-code-title]")].filter(
              (n) => n.textContent === "chat.ts",
            ).length === 2,
        );
        await groups.first().getByRole("tab", { name: "Python", exact: true }).click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("[data-docs-code-title]")].filter(
              (n) => n.textContent === "chat.py",
            ).length === 2,
        );
        await groups.first().getByRole("tab", { name: "TypeScript", exact: true }).click();
        await page.goto(base + "ai-gateway/quickstart");
        await page
          .locator('[data-docs-preference="api-language"]')
          .getByRole("tab", { name: "TypeScript", selected: true })
          .first()
          .waitFor();
        assert.ok(
          (await page
            .locator('[data-docs-preference="api-language"]')
            .getByRole("tab", { name: "TypeScript", selected: true })
            .count()) > 0,
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Switch code languages when preference storage is unavailable" */
await it("keeps the page choice usable when storage is denied", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("Denied");
          },
        });
      });
      try {
        const page = await context.newPage();
        await page.goto(base + "integration/mcp");
        await page
          .locator('[data-docs-preference="sdk-language"]')
          .first()
          .getByRole("tab", { name: "TypeScript", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("[data-docs-code-title]")].filter(
              (n) => n.textContent === "chat.ts",
            ).length === 2,
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Read code filenames and source without JavaScript" */
await it("prerenders file icons, filenames and readable source", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage({ javaScriptEnabled: false });
      try {
        await page.goto(base + "integration/mcp");
        const group = page.locator('[data-docs-preference="sdk-language"]').first();
        assert.equal(await group.locator("[data-docs-code-title]").textContent(), "chat.py");
        assert.ok((await group.locator("svg").count()) > 0);
        assert.match(
          await group.getByRole("tabpanel").filter({ visible: true }).textContent(),
          /from openai import OpenAI/,
        );
        assert.equal(
          await group.getByRole("button", { name: "Copy code", exact: true }).isDisabled(),
          true,
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Show the matching theme image and readable reference details" */
await it("shows one diagram variant, explicit matrix values and clear navigation in both themes", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const mode of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          colorScheme: mode,
          reducedMotion: "reduce",
        });
        await context.addInitScript((theme) => localStorage.setItem("theme", theme), mode);
        try {
          const page = await context.newPage();
          await page.goto(base + "self-hosting/overview");
          const light = page.locator('img[src*="/self-hosting-overview-light."]');
          const dark = page.locator('img[src*="/self-hosting-overview-dark."]');
          assert.equal(await light.isVisible(), mode === "light");
          assert.equal(await dark.isVisible(), mode === "dark");
          const diagram = page.locator("figure").filter({ has: light });
          await diagram.screenshot({
            path: path.join(screenshots, `docs-overview-diagram-${mode}.png`),
          });
          const other = mode === "light" ? "Dark" : "Light";
          await page.getByRole("button", { name: "Switch color theme" }).click();
          await page.waitForFunction(
            (theme) => document.documentElement.classList.contains("dark") === (theme === "Dark"),
            other,
          );
          await (other === "Dark" ? dark : light).waitFor({ state: "visible" });
          assert.equal(await dark.isVisible(), other === "Dark");
          assert.equal(await light.isVisible(), other === "Light");
          await page.getByRole("button", { name: "Switch color theme" }).click();
          await page.waitForFunction(
            (theme) => document.documentElement.classList.contains("dark") === (theme === "dark"),
            mode,
          );
          const matrix = page.locator("table").filter({ has: page.locator(".docs-matrix-value") });
          assert.equal(await matrix.locator('[data-answer="yes"]').count(), 10);
          assert.equal(await matrix.locator('[data-answer="no"]').count(), 6);
          await matrix.screenshot({
            path: path.join(screenshots, `docs-deployment-matrix-${mode}.png`),
          });
          const support = page
            .getByRole("navigation", { name: "Support", exact: true })
            .getByRole("link");
          assert.match(await support.getAttribute("href"), /^\/support(#|$)/);
          assert.doesNotMatch((await support.getAttribute("aria-label")) ?? "", /external site/);
          assert.ok((await support.locator("svg").count()) >= 1);
          await page.goto(base + "self-hosting/data-and-telemetry");
          assert.equal(await page.locator("table tr > :nth-child(5)").count(), 0);
          assert.ok(
            (await page.locator("code").filter({ hasText: "DISABLE_USAGE_STATS=true" }).count()) >
              0,
          );
          await page.locator("#the-usage-report-and-the-license-sync").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(screenshots, `docs-telemetry-details-${mode}.png`),
          });
          await page.goto(base + "integration/mcp");
          await page
            .locator('[data-docs-preference="sdk-language"]')
            .first()
            .getByRole("tab", { name: "TypeScript", exact: true })
            .click();
          const example = page.locator('[data-docs-preference="sdk-language"]').first();
          await page.waitForFunction(
            () =>
              document.querySelector('[data-docs-preference="sdk-language"] [data-docs-code-title]')
                ?.textContent === "chat.ts",
          );
          await example.locator("..").screenshot({
            path: path.join(screenshots, `docs-code-switcher-${mode}.png`),
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.evaluate(() => window.scrollTo(0, 0));
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({
            path: path.join(screenshots, `docs-mcp-mobile-${mode}.png`),
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(base + "integration/typescript/tutorials/manual-instrumentation");
          const card = page
            .locator(".docs-card [data-card-variant]:has([data-card-opener])")
            .first();
          const edges = await card.evaluate((node) => {
            const style = getComputedStyle(node);
            return [
              style.borderTopWidth,
              style.borderRightWidth,
              style.borderBottomWidth,
              style.borderLeftWidth,
            ].map(Number.parseFloat);
          });
          assert.ok(edges.every((width) => width >= 1));
          assert.ok(
            (await card.evaluate((node) =>
              Number.parseFloat(getComputedStyle(node).borderTopLeftRadius),
            )) >= 8,
          );
          assert.equal(await card.locator("[data-card-opener] a").count(), 1);
          await card.locator("a").first().focus();
          assert.equal(
            await card
              .locator("a")
              .first()
              .evaluate((node) => node === document.activeElement),
            true,
          );
          await card.screenshot({ path: path.join(screenshots, `docs-guide-card-${mode}.png`) });
        } finally {
          await context.close();
        }
      }
    },
  });
});

/** @scenario "Follow nested headings with an indented contents path" */
await it("draws the contents path through subsection indents without animation under reduced motion", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      try {
        await page.goto(base + "self-hosting/releases");
        const pathNode = page.locator(".docs-toc-path");
        await page.waitForFunction(() =>
          document.querySelector(".docs-toc-path")?.getAttribute("d"),
        );
        assert.match(await pathNode.getAttribute("d"), /C 4 [\d.]+ 16 [\d.]+ 16/);
        await page.locator('.docs-toc-rail a[data-nested="true"]').first().click();
        await page.waitForFunction(
          () =>
            document.querySelector('.docs-toc-rail [aria-current="location"]')?.dataset.nested ===
            "true",
        );
        assert.ok(
          await pathNode.evaluate(
            (node) => Number.parseFloat(node.style.strokeDasharray.split(/[,\s]+/)[1]) > 0,
          ),
        );
        assert.equal(
          await pathNode.evaluate((node) => getComputedStyle(node).transitionDuration),
          "0s",
        );
        assert.match(await page.locator("#preparing-for-321").textContent(), /3.21/);
        await page.setViewportSize({ width: 1440, height: 600 });
        await page.goto(base + "self-hosting/overview");
        const rail = page.locator(".docs-toc-container");
        await page.evaluate(() => window.scrollTo(0, 500));
        const pinned = await rail.evaluate((node) => ({
          position: getComputedStyle(node).position,
          bottom: node.getBoundingClientRect().bottom,
        }));
        assert.equal(pinned.position, "sticky");
        assert.ok(pinned.bottom <= 600 + 1);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const ends = await page.evaluate(() => ({
          rail: document.querySelector(".docs-toc-container").getBoundingClientRect().bottom,
          panel: document.querySelector(".docs-layout").getBoundingClientRect().bottom,
        }));
        assert.ok(ends.rail <= ends.panel + 1);
      } finally {
        await page.close();
      }
    },
  });
});
