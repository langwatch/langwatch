import { test, expect } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 20000,
});

test.setTimeout(60000);

/**
 * Test happy paths for prompt management
 * 1. Create a new prompt config
 * 2. Edit a prompt config
 * 3. Delete a prompt config
 */
test("Test happy paths for prompt management", async ({ page }) => {
  await page.goto("http://localhost:5560/fyes-lT_hZ2/prompt-configs");
  await page.getByText("No prompt configurations").click();
  await page.getByRole("button", { name: "Create New" }).click();
  await page.getByText("New Prompt Config").click();
  await page.getByRole("textbox", { name: "Prompt Name" }).click();
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .fill("Excellent Prompt For Testing");
  await page.getByTestId("save-version-button").click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("save new name");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  // await page.getByRole("textbox", { name: "Prompt Name" }).click();
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .fill("Excellent Prompt For Testing - New Name");
  await page
    .getByRole("group")
    .filter({ hasText: "Modelgpt-4o-mini" })
    .getByRole("button")
    .click();
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByRole("option", { name: "gpt-4-turbo", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Temperature" }).click();
  await page.getByRole("spinbutton", { name: "Temperature" }).fill("1");
  await page.getByRole("spinbutton", { name: "Max Tokens" }).click();
  await page.getByRole("spinbutton", { name: "Max Tokens" }).fill("1234");
  await page
    .locator("div")
    .filter({ hasText: /^LLM Config$/ })
    .getByRole("button")
    .click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).dblclick();
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("You're a great prompt!");
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
  await page
    .locator('select[name="version\\.configData\\.inputs\\.1\\.type"]')
    .selectOption("int");

  // Dismissing Next error issue, doesn't happen on test
  // await page.getByRole("button", { name: "Collapse issues badge" }).click();
  await page
    .locator('select[name="version\\.configData\\.outputs\\.1\\.type"]')
    .selectOption("code");
  await page.getByTestId("save-version-button").click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("changed things");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page.locator('[id="popover\\:\\:rd\\:\\:trigger"]').click();
  await page.getByText("Prompt NameCurrent").click();
  await page
    .getByRole("group")
    .filter({ hasText: "Current Versionchanged" })
    .click();
  await page
    .getByRole("group")
    .filter({
      hasText:
        "intstrimagefloatintboolllmprompting_techniquedatasetcodelist[str]",
    })
    .getByRole("button")
    .click();
  await page
    .getByRole("group")
    .filter({
      hasText: "codestrfloatintboolllmprompting_techniquedatasetcodelist[str]",
    })
    .getByRole("button")
    .click();
  await page.getByTestId("save-version-button").click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("deleted new input and output");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page
    .locator(".css-18y9d4a > div > div:nth-child(2) > .chakra-button")
    .click();
  await page.getByText("Excellent Prompt For Testing").click();
  await page.getByRole("textbox", { name: "Prompt Name" }).dblclick();
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .fill("going to delete this prompt");
  await page.getByTestId("save-version-button").click();
  await page.getByRole("textbox", { name: "Description" }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("deleting soon");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page
    .locator(".css-18y9d4a > div > div:nth-child(2) > .chakra-button")
    .click();
  await page
    .getByRole("row", { name: "going to delete this prompt" })
    .getByRole("button")
    .click();
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .fill("delete");
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .press("Enter");
  await page.getByText("No prompt configurations", { exact: false }).click();
});
