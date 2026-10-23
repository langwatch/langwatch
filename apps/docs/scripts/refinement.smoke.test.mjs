import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: { "out-dir": { type: "string" }, screenshots: { type: "string" } },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = path.resolve(values.screenshots ?? process.env.TMPDIR);
await mkdir(screenshots, { recursive: true });

/** @scenario "Open search only on explicit activation" */
await it("keeps focus on Search until activation and synchronizes destination metadata", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const page = await browser.newPage({
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        await page.goto(base + "introduction");
        const search = page.locator("[data-docs-search]:visible").first();
        await search.focus();
        assert.equal(await page.getByRole("searchbox").count(), 0);
        assert.equal(await search.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press("Control+k");
        await page.getByRole("searchbox").waitFor();
        await page.keyboard.press("Escape");
        await page.locator('#content a[href="/integration/quick-start"]').first().click();
        await page.waitForURL("**/integration/quick-start");
        const url = "https://langwatch.ai/docs/integration/quick-start";
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), url);
        assert.equal(await page.locator('meta[property="og:url"]').getAttribute("content"), url);
        assert.equal(
          await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute("href"),
          "/integration/quick-start.md",
        );
        const metadata = JSON.parse(
          await page.locator("script[data-docs-metadata]").first().textContent(),
        );
        assert.equal(metadata.url, url);
        await page.goto(base + "ai-governance/ingestion-sources");
        await page.keyboard.press("Control+k");
        await page.getByRole("searchbox").waitFor();
        await page.locator("#docs-search-results button").filter({ hasText: "Copy page" }).click();
        await page.getByText("Page copied", { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          await readFile(path.join(outDir, "ai-governance/ingestion-sources/index.md"), "utf8"),
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Discover page exports and crawlable documentation" */
await it("serves identical page exports and discovery metadata", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext();
      try {
        for (const slug of ["index", "coding-agents/overview", "api-reference/traces/get-trace"]) {
          const markdown = await readFile(path.join(outDir, `${slug}.md`), "utf8");
          for (const extension of ["md", "claude", "agent"]) {
            const response = await context.request.get(`${base}${slug}.${extension}`);
            assert.equal(response.status(), 200);
            assert.match(response.headers()["content-type"], /text\/markdown/);
            assert.equal(await response.text(), markdown);
          }
        }
        for (const name of ["robots.txt", "humans.txt", "agents.txt", "sitemap.xml", "llms.txt"]) {
          assert.equal((await context.request.get(base + name)).status(), 200, name);
        }
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Copy a supported coding-agent command on any page" */
await it("copies supported agent commands on guides, overview and API pages", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        const page = await context.newPage();
        for (const slug of [
          "introduction",
          "coding-agents/overview",
          "api-reference/traces/get-trace",
        ]) {
          await page.goto(base + slug);
          const launcher = page.locator(".docs-layout .docs-agent-launcher");
          for (const agent of ["claude", "codex", "copilot", "gemini", "opencode"]) {
            await launcher.getByLabel("Coding agent").selectOption(agent);
            const button = launcher.getByRole("button");
            await button.click();
            await page.waitForFunction(
              (expected) => navigator.clipboard.readText().then((text) => text === expected),
              `npx langwatch ${agent}`,
            );
          }
          const report = page.getByRole("link", { name: "Report a problem" });
          const issue = new URL(await report.getAttribute("href"));
          assert.match(issue.searchParams.get("body"), new RegExp(slug));
        }
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Copy a page with the keyboard" */
await it("copies Markdown with Alt Shift C and leaves editable controls alone", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({
        permissions: ["clipboard-read", "clipboard-write"],
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.goto(base + "coding-agents/overview");
        await page.waitForFunction(() =>
          Boolean(document.querySelector("script[data-island=toc]")),
        );
        await page.keyboard.press("Alt+Shift+c");
        const markdown = await readFile(path.join(outDir, "coding-agents/overview.md"), "utf8");
        await page.waitForFunction(
          (expected) => navigator.clipboard.readText().then((text) => text === expected),
          markdown,
        );
        await page.locator(".docs-layout .docs-agent-launcher select").focus();
        await page.evaluate(() => navigator.clipboard.writeText("keep me"));
        await page.keyboard.press("Alt+Shift+c");
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "keep me");
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Reveal an overflowing tab without moving the document" */
await it("reveals the final setup tab horizontally while preserving vertical scroll", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.goto(base + "coding-agents/overview");
        const tabs = page.locator('#content [role="tablist"]').first();
        await tabs.scrollIntoViewIfNeeded();
        await tabs.getByRole("tab").first().focus();
        const top = await page.evaluate(() => scrollY);
        await page.keyboard.press("End");
        const last = tabs.getByRole("tab").last();
        assert.equal(await last.getAttribute("aria-selected"), "true");
        const bounds = await tabs.boundingBox();
        const item = await last.boundingBox();
        assert.ok(item.x >= bounds.x - 1 && item.x + item.width <= bounds.x + bounds.width + 1);
        assert.equal(await page.evaluate(() => scrollY), top);
        await tabs.getByRole("tab", { name: "Codex", exact: true }).click();
        assert.match(
          await page.locator('#content [role="tabpanel"]:not([hidden])').first().textContent(),
          /npx langwatch codex/,
        );
      } finally {
        await context.close();
      }
    },
  });
});

await it("renders responsive product imagery and a solid footer across themes and screen sizes", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const mode of ["light", "dark"])
        for (const width of [390, 1440]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: mode,
            reducedMotion: "reduce",
          });
          try {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.goto(base + "coding-agents/overview", { waitUntil: "networkidle" });
            await page.evaluate(() => document.fonts.ready);
            const image = page.locator(".docs-product-shot");
            assert.ok(await image.evaluate((node) => node.complete && node.naturalWidth > 0));
            assert.match(await image.evaluate((node) => node.currentSrc), /\.webp$/);
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            );
            await page.screenshot({ path: path.join(screenshots, `coding-${width}-${mode}.png`) });
            await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
            const bottom = await page.evaluate(() => {
              const footer = document.querySelector(".docs-site-footer");
              return {
                edge: footer.getBoundingClientRect().bottom,
                paper: getComputedStyle(footer).backgroundColor,
                body: getComputedStyle(document.body).backgroundColor,
                overscroll: getComputedStyle(document.body).overscrollBehaviorY,
              };
            });
            assert.ok(Math.abs(bottom.edge - 1000) < 2);
            assert.equal(bottom.paper, bottom.body);
            assert.equal(bottom.overscroll, "none");
            await page.screenshot({ path: path.join(screenshots, `footer-${width}-${mode}.png`) });
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
    },
  });
});

/** @scenario "Choose a page action from a compact menu" */
await it("shows each page action on an icon chip with the copy shortcut", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(base + "integration/quick-start");
        await page.getByRole("button", { name: "More page actions" }).click();
        const menu = page.getByRole("menu", { name: "Page actions" });
        await menu.waitFor();
        const items = menu.getByRole("menuitem");
        const count = await items.count();
        assert.ok(count > 2);
        assert.equal(await menu.locator("[role=menuitem] > .docs-menu-icon").count(), count);
        const shortcut = menu.locator(".docs-menu-shortcut");
        assert.equal(await shortcut.textContent(), "Alt+Shift+C");
        assert.ok(await shortcut.isVisible());
      } finally {
        await context.close();
      }
    },
  });
});
