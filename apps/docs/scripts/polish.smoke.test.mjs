import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { createServer } from "vite";

import { docsDevPlugin } from "../src/site/dev-server.ts";
import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: {
    "out-dir": { type: "string" },
    screenshots: { type: "string" },
    before: { type: "string" },
  },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = path.resolve(values.screenshots ?? "polish-shots");
await mkdir(screenshots, { recursive: true });
async function shot({ page, name }) {
  await page.screenshot({ animations: "disabled", path: path.join(screenshots, `${name}.png`) });
}
async function reader({ browser, mode = "dark", width = 1440 }) {
  const context = await browser.newContext({
    viewport: { width, height: 1100 },
    colorScheme: mode,
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript((theme) => localStorage.setItem("theme", theme), mode);
  return context;
}
async function comparisonShots({ directory, label }) {
  await withPreviewBrowser({
    outDir: directory,
    run: async ({ browser, base }) => {
      for (const mode of ["light", "dark"]) {
        const context = await reader({ browser, mode });
        try {
          const page = await context.newPage();
          await page.goto(base + "integration/quick-start");
          await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() =>
            Boolean(document.querySelector('script[data-island="toc"]')),
          );
          await page.evaluate(() => scrollTo(0, 0));
          await shot({ page, name: `guide-${label}-${mode}` });
          await page.goto(base + "introduction");
          await page.locator(".docs-agent-start").scrollIntoViewIfNeeded();
          await shot({ page, name: `agent-${label}-${mode}` });
        } finally {
          await context.close();
        }
      }
    },
  });
}
if (values.before)
  await comparisonShots({ directory: path.resolve(values.before), label: "before" });
await comparisonShots({ directory: outDir, label: "after" });

/** @scenario "Use the shared command surface" */
await it("groups documentation in the command surface and supports keyboard navigation and actions", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      const context = await reader({ browser });
      try {
        const page = await context.newPage();
        await page.goto(base + "integration/quick-start");
        await page.keyboard.press("Control+k");
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        const input = page.getByRole("searchbox");
        await input.fill("traces");
        await page.locator(".docs-command-operation").first().waitFor();
        assert.ok(await dialog.getByText("API Reference", { exact: true }).count());
        await page.keyboard.press("ArrowDown");
        const selected = await input.getAttribute("aria-activedescendant");
        const href = await page.locator(`#${selected} a`).getAttribute("href");
        await shot({ page, name: "command-results-dark" });
        await page.keyboard.press("Enter");
        await page.waitForURL((url) => url.pathname + url.hash === href);
        await page.keyboard.press("Control+k");
        await page.getByRole("searchbox").fill("Toggle theme");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.documentElement.classList.contains("light"));
        await page.getByRole("searchbox").fill("Copy page");
        await page.keyboard.press("Enter");
        await page.getByText("Page copied", { exact: true }).waitFor();
        assert.equal(await page.locator('script[data-island="controls"]').count(), 0);
        assert.equal(await page.locator("html").getAttribute("class"), "light");
        assert.ok((await page.evaluate(() => navigator.clipboard.readText())).length > 100);
        await page.getByRole("searchbox").fill("traces");
        await shot({ page, name: "command-results-light" });
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await page.locator(".docs-command-bar").count(), 0);
      } finally {
        await context.close();
      }
    },
  });
});

/** @scenario "Use clear contextual menus" */
await it("shows descriptive page actions and the selected theme in design-system menus", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const mode of ["light", "dark"]) {
        const context = await reader({ browser, mode });
        try {
          await context.addInitScript(() =>
            Object.defineProperty(navigator, "platform", { value: "Linux x86_64" }),
          );
          const page = await context.newPage();
          await page.goto(base + "api-reference/introduction");
          assert.match(await page.locator(".docs-shortcut").textContent(), /CtrlK/);
          await page.getByRole("button", { name: "More page actions" }).click();
          const menu = page.getByRole("menu", { name: "Page actions" });
          await menu.waitFor();
          assert.ok((await menu.boundingBox()).width >= 280);
          await menu.getByRole("menuitem", { name: /^Copy page Copy this/ }).click();
          await menu.getByText("Copied page", { exact: true }).waitFor();
          assert.equal(
            await page.evaluate(() => navigator.clipboard.readText()),
            await readFile(path.join(outDir, "api-reference/introduction.md"), "utf8"),
          );
          await shot({ page, name: `page-menu-${mode}` });
          await page.keyboard.press("Escape");
          await page.getByRole("button", { name: "Colour theme" }).click();
          const theme = page.getByRole("menu", { name: "Colour theme" });
          await theme.waitFor();
          assert.equal(
            await theme.locator(`[data-theme=${mode}]`).getAttribute("aria-checked"),
            "true",
          );
          await shot({ page, name: `theme-menu-${mode}` });
          await theme.locator("[data-theme=system]").click();
          await page.getByRole("button", { name: "Colour theme" }).click();
          assert.equal(
            await theme.locator("[data-theme=system]").getAttribute("aria-checked"),
            "true",
          );
        } finally {
          await context.close();
        }
      }
    },
  });
});

/** @scenario "Start with a coding agent" */
await it("copies the complete prompt with branded selection and a visible success state", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const width of [1440, 390]) {
        const context = await reader({ browser, width });
        try {
          const page = await context.newPage();
          await page.goto(base + "introduction");
          const card = page.locator(".docs-agent-start");
          await card.locator('[data-docs-agent="Codex"]').click();
          await page.waitForFunction(
            () =>
              document.querySelector('[data-docs-agent="Codex"]')?.getAttribute("aria-pressed") ===
              "true",
          );
          assert.equal(await card.locator(".docs-agent-logo").count(), 3);
          const full = await card.locator("pre").textContent();
          await card.getByRole("button", { name: "Copy setup prompt" }).click();
          await card.getByRole("button", { name: "Prompt copied" }).waitFor();
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), full);
          assert.match(await card.locator("output").textContent(), /Paste into your agent/);
          assert.equal(await page.locator(".docs-ground-live").count(), 0);
          await shot({ page, name: `agent-success-${width}-dark` });
        } finally {
          await context.close();
        }
      }
    },
  });
});

/** @scenario "Render brand marks during development" */
await it("serves brand SVGs with an image type that browsers can decode", async () => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { port: 0, host: "127.0.0.1" },
    plugins: [docsDevPlugin({ docsRoot: path.resolve("../../docs") })],
  });
  try {
    await server.listen();
    const url = `${server.resolvedUrls.local[0]}images/logos/codex.svg`;
    const response = await fetch(url);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    await withPreviewBrowser({
      outDir,
      run: async ({ browser }) => {
        const page = await browser.newPage();
        try {
          await page.setContent(`<img src="${url}" alt="Codex">`);
          assert.ok(
            await page.locator("img").evaluate(async (node) => {
              await node.decode();
              return node.naturalWidth > 0;
            }),
          );
        } finally {
          await page.close();
        }
      },
    });
  } finally {
    await server.close();
  }
});
