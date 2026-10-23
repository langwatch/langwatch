import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { withPreviewBrowser } from "./browser-fixture.mjs";

const { values } = parseArgs({
  options: { "out-dir": { type: "string" }, screenshots: { type: "string" } },
});
const outDir = path.resolve(values["out-dir"] ?? "dist");
const screenshots = values.screenshots ?? (await mkdtemp(path.join(os.tmpdir(), "docs-session-")));
await mkdir(screenshots, { recursive: true });

async function checkSession({ browser, base, width, mode }) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    colorScheme: mode,
    permissions: ["clipboard-read", "clipboard-write"],
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const apiCalls = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://app.langwatch.ai/**", async (route) => {
      apiCalls.push(route.request().url());
      await route.abort();
    });
    await page.clock.install();
    await page.goto(`${base}api-reference/traces/get-trace`);
    await page.getByRole("button", { name: "Try it", exact: true }).click();
    const form = page.locator("#try-it-form");
    await form.getByLabel("X-Auth-Token value").fill("not-a-real-key");
    await form.getByRole("button", { name: "Use my LangWatch session" }).click();
    await form.getByText("Docs demo project", { exact: true }).waitFor();
    assert.equal(await form.getByLabel("X-Auth-Token value").count(), 0);
    await page.locator("#pg-path-traceId").fill("demo-trace");
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(screenshots, `session-${width}-${mode}.png`),
      animations: "disabled",
    });
    await form.getByRole("button", { name: "Send request", exact: true }).click();
    await page
      .getByText("Simulated response. No request was sent to LangWatch.", { exact: false })
      .waitFor();
    assert.equal(
      (await page.locator("body").textContent()).includes("docs-demo-not-a-credential"),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        [localStorage, sessionStorage].some((storage) =>
          Object.keys(storage).some((key) =>
            String(storage.getItem(key)).includes("docs-demo-not-a-credential"),
          ),
        ),
      ),
      false,
    );
    const exampleToggle = page
      .locator("summary")
      .filter({ hasText: "Request and response examples" });
    if (await exampleToggle.isVisible()) await exampleToggle.click();
    await page.getByRole("button", { name: "Copy code", exact: true }).first().click();
    await page.getByRole("button", { name: "Copied", exact: true }).first().waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copied.includes("LANGWATCH_API_KEY"));
    assert.equal(copied.includes("docs-demo-not-a-credential"), false);
    await page.clock.fastForward(61_000);
    await form.getByText("Session expired. Connect again to continue.").waitFor();
    assert.ok(await form.getByRole("button", { name: "Send request", exact: true }).isDisabled());
    await form.getByRole("button", { name: "Use my LangWatch session" }).click();
    await form.getByText("Docs demo project", { exact: true }).waitFor();
    await form.getByRole("button", { name: "Disconnect", exact: true }).click();
    assert.equal(await form.getByLabel("X-Auth-Token value").inputValue(), "");
    assert.deepEqual(apiCalls, []);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  } finally {
    await context.close();
  }
}

/** @scenario "Try the session seam without sending a real credential" */
await it(
  "connects, simulates, expires and disconnects without contacting an API",
  { skip: "the session button is off until signed-in sessions return" },
  async () => {
    await withPreviewBrowser({
      outDir,
      run: async ({ browser, base }) => {
        for (const width of [1440, 390]) {
          for (const mode of ["light", "dark"]) await checkSession({ browser, base, width, mode });
        }
      },
    });
  },
);
