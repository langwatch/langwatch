import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { assertAgentSetup, tracingPrompt } from "./browser-checks.mjs";
import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({ options: { "out-dir": { type: "string" } } });
const outDir = path.resolve(values["out-dir"] ?? "dist");
const shots = path.resolve(process.env.TMPDIR ?? "node_modules/.cache/docs-ui-shots");
await mkdir(shots, { recursive: true });

/** @scenario "Choose an agent and copy the complete setup prompt" */
await it("keeps agent commands deliberate and setup prompts complete in both themes", async () => {
  const prompt = await tracingPrompt({ outDir });
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
        try {
          await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
          await page.goto(base + "introduction");
          await page.waitForFunction(() => {
            const launcher = document.querySelector(".docs-left-rail .docs-agent-launcher");
            const select = launcher?.querySelector("select");
            const name = launcher?.querySelector(".docs-agent-name");
            return select?.value !== "claude" && name && name.textContent !== select?.value;
          });
          assert.ok(
            await page.getByText("Trace any coding agent", { exact: false }).first().isVisible(),
          );
          await assertAgentSetup({ page, base, prompt });
          assert.equal(
            await page.locator("html").evaluate((node) => node.classList.contains("dark")),
            theme === "dark",
          );
          const setup = page.locator(".docs-agent-start");
          const copy = setup.locator("[data-docs-prompt]");
          assert.equal(await copy.count(), 1);
          assert.ok(
            await copy.evaluate((node) => node.parentElement.textContent.includes("Setup prompt")),
          );
          const launcher = page.locator(".docs-left-rail .docs-agent-launcher");
          const select = launcher.getByLabel("Coding agent");
          assert.equal(await select.evaluate((node) => getComputedStyle(node).opacity), "1");
          await select.selectOption("opencode");
          await launcher.getByRole("button").click();
          await page.waitForFunction(() =>
            navigator.clipboard.readText().then((text) => text === "npx langwatch opencode"),
          );
          await page.locator('#content a[href="/integration/quick-start"]').first().click();
          await page.waitForURL("**/integration/quick-start");
          assert.equal(await select.inputValue(), "opencode");
          await page.goto(base + "introduction");
          await page.getByRole("button", { name: "Copy setup prompt" }).waitFor();
          await launcher.screenshot({ path: path.join(shots, `docs-agent-command-${theme}.png`) });
          await setup.screenshot({ path: path.join(shots, `docs-agent-setup-${theme}.png`) });
          await page.setViewportSize({ width: 390, height: 844 });
          await setup.scrollIntoViewIfNeeded();
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assert.ok(await copy.isVisible());
          await setup.screenshot({
            path: path.join(shots, `docs-agent-setup-mobile-${theme}.png`),
          });
        } finally {
          await page.close();
        }
      }
      const page = await browser.newPage({ javaScriptEnabled: false });
      try {
        await page.goto(base + "introduction");
        const setup = page.locator(".docs-agent-start");
        await setup.locator("summary").click();
        assert.equal(await setup.getByLabel("Full setup prompt").textContent(), prompt);
        assert.ok(await setup.getByRole("button", { name: "Copy setup prompt" }).isDisabled());
        assert.ok(
          await page
            .locator(".docs-left-rail")
            .getByLabel("Coding agent", { exact: true })
            .isVisible(),
        );
      } finally {
        await page.close();
      }
    },
  });
});

/** @scenario "Browse compact API schemas and skill actions" */
await it("makes API data, skill actions and selection movement readable", async () => {
  await withPreviewBrowser({
    outDir,
    run: async ({ browser, base }) => {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          permissions: ["clipboard-read", "clipboard-write"],
        });
        try {
          await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
          await page.goto(base + "api-reference/traces/discover-what-the-trace-filter-fields-ho");
          assert.ok(
            await page.locator("header").getByText("Examples", { exact: true }).isVisible(),
          );
          assert.ok((await page.locator(".docs-json-key:visible").count()) > 0);
          await page.getByRole("button", { name: "Try it", exact: true }).click();
          const fields = page.locator(".docs-request-fields").first();
          await fields.waitFor();
          assert.equal(
            await fields.evaluate(
              (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
            ),
            2,
          );
          await page
            .locator("[data-docs-playground]")
            .screenshot({ path: path.join(shots, `docs-api-controls-${theme}.png`) });
          await page
            .locator("#responses")
            .screenshot({ path: path.join(shots, `docs-api-schemas-${theme}.png`) });
          await page.goto(base + "skills/directory");
          const card = page.locator(".docs-skill-card").first();
          await card.getByRole("button", { name: "Copy full prompt", exact: true }).click();
          await card.getByRole("button", { name: "Copied", exact: true }).waitFor();
          assert.equal(
            await page.evaluate(() => navigator.clipboard.readText()),
            await tracingPrompt({ outDir }),
          );
          await card.locator("summary").click();
          assert.ok(await card.locator(".docs-code-region").isVisible());
          await card.locator("summary").click();
          await card.screenshot({ path: path.join(shots, `docs-skill-card-${theme}.png`) });
          await page.goto(base + "integration/cli");
          await page.waitForFunction(() => document.querySelector(".docs-nav-indicator"));
          const marker = page.locator(".docs-left-rail .docs-nav-indicator");
          const before = await marker.evaluate((node) => node.style.transform);
          await page
            .locator('.docs-left-rail nav[aria-label="Page navigation"] a[href="/integration/mcp"]')
            .click();
          await page.waitForURL("**/integration/mcp");
          await page.waitForFunction(
            (old) => document.querySelector(".docs-nav-indicator")?.style.transform !== old,
            before,
          );
          assert.notEqual(await marker.evaluate((node) => node.style.transform), before);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page
            .locator('.docs-left-rail nav[aria-label="Page navigation"] a[href="/integration/cli"]')
            .click();
          await page.waitForURL("**/integration/cli");
          assert.equal(await marker.evaluate((node) => node.getAnimations().length), 0);
        } finally {
          await page.close();
        }
      }
      const page = await browser.newPage({ javaScriptEnabled: false });
      try {
        await page.goto(base + "api-reference/traces/discover-what-the-trace-filter-fields-ho");
        const errors = page.locator(".docs-response-schema:not([open])");
        assert.ok((await errors.count()) > 0);
        const index = await page
          .locator(".docs-response-schema")
          .evaluateAll((nodes) => nodes.findIndex((node) => !node.hasAttribute("open")));
        const error = page.locator(".docs-response-schema").nth(index);
        await error.locator("summary").click();
        assert.equal(await error.getAttribute("open"), "");
        assert.ok(await error.locator(".docs-field").first().isVisible());
      } finally {
        await page.close();
      }
    },
  });
});
