import { existsSync } from "node:fs";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeBrowser, Side } from "../capture.ts";

const installed = existsSync(chromium.executablePath());
const FROZEN = 1_700_000_000_000;
const PAGE = "data:text/html,<title>t</title>";

describe.skipIf(!installed)("Feature: a flow's clock follows its own steps", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    if (browser !== undefined) await closeBrowser(browser);
  });

  const pageTime = async ({ live }: { live: boolean }): Promise<number> => {
    const context = await browser.newContext();
    await context.clock.setFixedTime(FROZEN);
    const page = await context.newPage();
    const side = new Side("candidate", "", page, { quietMillis: 1, deadlineMillis: 1 }, { live });
    await side.goto(PAGE);
    const seen = await page.evaluate(() => Date.now());
    await context.close();
    return seen;
  };

  describe("when a flow's page navigates after creating data", () => {
    it("sees the present, not the plan's frozen time", async () => {
      const before = Date.now();
      expect(await pageTime({ live: true })).toBeGreaterThanOrEqual(before);
    });
  });

  describe("when a route's page navigates", () => {
    it("keeps the plan's frozen time so relative dates stay stable", async () => {
      expect(await pageTime({ live: false })).toBe(FROZEN);
    });
  });
});
