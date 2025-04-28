import { test, expect } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 240000,
});

test.setTimeout(240000);

/**
 * Test happy paths for prompt management from workflow
 * 1. Create a new workflow
 * 2. Create a new prompt config
 * 3. Edit a prompt config
 * 4. Delete a prompt config
 */
test("Prompt Management from Workflow", async ({ page }) => {
  await page.goto("http://localhost:5560/fyes-lT_hZ2");
  await page.getByRole("link", { name: "Workflows" }).click();
  await page.getByTestId("active-create-new-workflow-button").click();
  await page.getByTestId("new-workflow-card-simple_rag").click();
  await page
    .getByRole("textbox", { name: "Name and Icon" })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Name and Icon" })
    .fill("Test New Rag for Prompt Management");
  await page.getByRole("button", { name: "Create Workflow" }).click();
  await page.getByTestId("rf__node-generate_query").click();
  await page.getByRole("textbox", { name: "Prompt Name" }).click();
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .fill("We will use this prompt in the other node");
  await page
    .getByRole("group")
    .filter({ hasText: "Modelgpt-4o-mini" })
    .getByRole("button")
    .click();
  await page.getByRole("combobox", { name: "Model" }).click();
  await page
    .getByRole("option", { name: "gpt-3.5-turbo", exact: true })
    .locator("div")
    .first()
    .click();
  await page.getByRole("spinbutton", { name: "Temperature" }).click();
  await page.getByRole("spinbutton", { name: "Temperature" }).fill("1");
  await page.getByRole("spinbutton", { name: "Temperature" }).press("Tab");
  await page.getByRole("spinbutton", { name: "Max Tokens" }).fill("1234");
  await page.getByRole("spinbutton", { name: "Max Tokens" }).press("Tab");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("This is a great new prompt");
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
    .fill("test");
  await page
    .locator("div")
    .filter({ hasText: /^Outputs$/ })
    .getByRole("button")
    .click();
  await page
    .locator("div")
    .filter({ hasText: /^Outputs$/ })
    .getByRole("button")
    .press("Tab");
  await page
    .locator('input[name="version\\.configData\\.outputs\\.1\\.identifier"]')
    .click();
  await page
    .locator('input[name="version\\.configData\\.outputs\\.1\\.identifier"]')
    .fill("test2");
  // await page
  //   .locator('[id="field\\:\\:\\:r5i\\:"] > div > .chakra-button')
  //   .click();
  await page.getByTestId("save-version-button").click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Saving a new version");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("div:nth-child(2) > button:nth-child(3)").click();
  await page.getByRole("button", { name: "zoom out" }).click();
  await page.getByTestId("rf__node-generate_answer").click();
  await page
    .getByRole("button", { name: "GenerateAnswer - Save from" })
    .click();
  await page
    .getByTestId("prompt-source-dialog")
    .getByText(/We will use this prompt in the other node/)
    .click();
  await page.locator("div:nth-child(2) > button:nth-child(3)").click();
  await page.getByTestId("rf__node-generate_query").click();
  await page
    .getByRole("group")
    .filter({ hasText: "Source PromptWe will use this" })
    .getByRole("button")
    .nth(2)
    .click();
  // await page.locator('[id="tooltip\\:\\:r70\\:\\:trigger"]').click();
  await page.getByRole("button", { name: "close" }).click();
  await page
    .getByRole("group")
    .filter({ hasText: "Source PromptWe will use this" })
    .getByRole("button")
    .nth(2)
    .click();
  await page.getByTestId("restore-version-button-1").click();
  await page.getByRole("button", { name: "close" }).click();
  await page
    .getByRole("group")
    .filter({ hasText: "Source PromptWe will use this" })
    .getByRole("button")
    .nth(2)
    .click();
  await page.getByTestId("restore-version-button-0").click();
  await page.getByRole("button", { name: "close" }).click();
  await page.getByRole("link").first().click();
  await page.goto("http://localhost:5560/fyes-lT_hZ2/prompt-configs");
  await page
    .getByRole("row", { name: "We will use this prompt in" })
    .getByRole("button")
    .click();
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .fill("delete");
  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("row", { name: "GenerateAnswer" })
    .getByRole("button")
    .click();
  await page.getByRole("textbox", { name: "Type 'delete' to confirm" }).click();
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .fill("delete");
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .press("Enter");
});
