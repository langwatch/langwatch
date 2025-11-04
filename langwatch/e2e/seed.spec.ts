import { test, expect } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 20000,
});

test.setTimeout(60000);

test.describe("Prompts Page", () => {
  test("seed", async ({ page }) => {
    // Navigate to the prompts page for the test project
    await page.goto("http://localhost:5560/e2e-test-org-1dhzb-project/prompts");

    // Verify page loaded
    await expect(page).toHaveURL(/\/prompts$/);
  });
});
