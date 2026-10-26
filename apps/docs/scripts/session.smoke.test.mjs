import assert from "node:assert/strict";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

/* Runs against a haven stack built with `--app-origin self`, signed in through
   `haven browser login --as admin --out <state>`; never against a shared deployment. */
const { values } = parseArgs({
  options: { base: { type: "string" }, state: { type: "string" } },
});
assert.ok(
  values.base && values.state,
  "pass --base https://app.<slug>.langwatch.localhost --state <file>",
);
const base = new URL(values.base).origin;
assert.match(
  new URL(base).hostname,
  /\.localhost$/,
  "the session smoke runs only on a local stack",
);
const slug = "api-reference/datasets/list-dataset";
const endpoint = "/api/v1/dataset";

/** @scenario "Connect and send through haven, where the docs share the app's address" */
await it("connects, sends as the member, and loses access when the member signs out", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      storageState: values.state,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/docs/${slug}`, { waitUntil: "networkidle" });
    await page.click("#try-it-button");

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.click("[data-docs-session-connect]"),
    ]);
    await popup.getByRole("button", { name: "Allow" }).click();
    await popup.waitForEvent("close");
    const status = page.locator("[data-docs-session-status]");
    await assert.doesNotReject(status.filter({ hasText: /^Sending as you in / }).waitFor());

    const send = async () => {
      const [response] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === endpoint),
        page.click("#pg-send"),
      ]);
      return response;
    };
    const granted = await send();
    const headers = await granted.request().allHeaders();
    assert.equal(granted.status(), 200);
    assert.ok(headers["x-auth-token"], "the key travels as X-Auth-Token");
    assert.equal(headers.cookie, undefined, "the docs never send the app's cookies");

    const app = await context.newPage();
    await app.goto(`${base}/api/auth/logout`);
    await app.close();
    const ended = await send();
    assert.equal(ended.status(), 401);
    await status.filter({ hasText: /Your access ended/ }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
