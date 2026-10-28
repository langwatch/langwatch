import assert from "node:assert/strict";
import { it } from "node:test";
import { parseArgs } from "node:util";

import { chromium } from "playwright";

/* Runs against a haven stack built with `--app-origin self`, signed in through
   `haven browser login --as admin --out <state>`; never against a shared deployment.
   The test signs that session out, so sign in again before the next run. */
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
await it("connects, disconnects, sends as the member, and loses access when the member signs out", async () => {
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

    /* The key lives in the app's session frame; its controls and status are inside it. */
    const frame = page.frameLocator("iframe.docs-session-frame");
    const status = frame.locator("#status");
    const connect = async () => {
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        frame.getByRole("button", { name: "Use my LangWatch account" }).click(),
      ]);
      await popup.getByRole("button", { name: "Allow" }).click();
      await popup.waitForEvent("close");
      await status.filter({ hasText: /^Sending as you in / }).waitFor();
    };
    await connect();
    await frame.getByRole("button", { name: "Disconnect" }).click();
    await status.filter({ hasText: /^Disconnected\.$/ }).waitFor();
    await connect();

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
    assert.equal(headers.cookie, undefined, "the frame never sends the app's cookies");
    assert.equal(
      granted.frame().url().split("?")[0],
      `${base}/connect/docs/frame`,
      "the session frame sends the request, not the docs page",
    );
    const pageHolds = await page.evaluate(
      () =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]) +
        document.documentElement.outerHTML,
    );
    assert.ok(!pageHolds.includes(headers["x-auth-token"]), "the docs page never holds the key");

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
