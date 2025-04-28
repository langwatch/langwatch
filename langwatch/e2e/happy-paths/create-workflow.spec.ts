import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 120000,
});

test.setTimeout(120000);

export const createWorkflow = async (page: Page) => {
  await page.goto("http://localhost:5560/fyes-lT_hZ2");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByTestId("active-create-new-workflow-button").click();
  await page.getByTestId("new-workflow-card-simple_rag").click();
  await page.getByRole("textbox", { name: "Name and Icon" }).click();
  await page
    .getByRole("textbox", { name: "Name and Icon" })
    .fill("Test Simple RAG");
  await page.getByRole("button", { name: "Create Workflow" }).click();
};

/**
 * Test happy paths for creating a new workflow
 * 1. Create a new workflow
 */
test("Create a new workflow", async ({ page }) => {
  await createWorkflow(page);
});
