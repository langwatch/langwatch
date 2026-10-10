import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await use(page);
  },
});

export { expect };
export type { BrowserContext, Locator, Page } from "@playwright/test";
