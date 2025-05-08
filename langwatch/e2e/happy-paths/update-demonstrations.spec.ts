import { test, expect } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 120000,
});

test.setTimeout(120000);

test("Update Demonstrations", async ({ page }) => {
  await page.goto("http://localhost:5560/fyes-lT_hZ2");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByTestId("active-create-new-workflow-button").click();
  await page.getByTestId("new-workflow-card-simple_rag").click();
  await page.getByRole("button", { name: "Create Workflow" }).click();
  await page.getByTestId("rf__node-generate_query").click();
  await page
    .locator("div")
    .filter({ hasText: /^Inputs$/ })
    .getByRole("button")
    .click();
  await page
    .locator('input[name="version\\.configData\\.inputs\\.1\\.identifier"]')
    .click();
  await page
    .locator('input[name="version\\.configData\\.inputs\\.1\\.identifier"]')
    .fill("new_input");
  await page
    .locator("div")
    .filter({ hasText: /^Outputs$/ })
    .getByRole("button")
    .click();
  await page
    .locator('input[name="version\\.configData\\.outputs\\.1\\.identifier"]')
    .click();
  await page
    .locator('input[name="version\\.configData\\.outputs\\.1\\.identifier"]')
    .fill("new_output");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Add new record" }).click();
  await page.getByRole("menuitem", { name: "Add new line" }).click();

  // TODO: Finish this test
});
