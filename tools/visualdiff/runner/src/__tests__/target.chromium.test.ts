import { existsSync } from "node:fs";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeBrowser } from "../capture";
import { targetOf } from "../flows/target";

const installed = existsSync(chromium.executablePath());

describe.skipIf(!installed)("Feature: flows name elements by test id", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    if (browser !== undefined) await closeBrowser(browser);
  });

  /** @scenario Steps target elements by test id, prefix or label */
  it("finds visible elements by test id, prefix, label and text within", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <button data-testid="save">Save</button>
      <div data-testid="row-1">Alpha</div><div data-testid="row-2">Beta</div>
      <div data-testid="row-3" style="display:none">Hidden</div>
      <button aria-label="Close dialog">x</button>`);

    expect(await targetOf({ root: page, args: { testId: "save" } }).count()).toBe(1);
    expect(await targetOf({ root: page, args: { testIdPrefix: "row-" } }).count()).toBe(2);
    expect(await targetOf({ root: page, args: { testIdPrefix: "row-", hasText: "Beta" } }).count()).toBe(1);
    expect(await targetOf({ root: page, args: { label: "Close dialog" } }).count()).toBe(1);
    expect(() => targetOf({ root: page, args: {} })).toThrow("name the element");
    await page.close();
  });
});
