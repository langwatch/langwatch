import { test, expect } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 20000,
});

test("test", async ({ page }) => {
  await page.goto("http://localhost:5560/fyes-lT_hZ2/prompt-configs");
  await page.getByRole("button", { name: "Create New" }).click();
  await page.getByText("New Prompt Config").first().click();
  await page.getByText("Initial version").click();
  await page.getByRole("textbox", { name: "Prompt Name" }).dblclick();
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .press("ControlOrMeta+a");
  await page.getByRole("textbox", { name: "Prompt Name" }).fill("New Config ");
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .press("ControlOrMeta+a");
  await page
    .getByRole("textbox", { name: "Prompt Name" })
    .fill("Updated config name");
  await page.getByTestId("save-version-button").click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("Update config name");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page.getByText("Updated config name").click();
  await page
    .getByRole("group")
    .filter({ hasText: "Modelgpt-4o-mini" })
    .getByRole("button")
    .click();
  await page.getByRole("combobox", { name: "Model" }).click();
  await page.getByText("gpt-4-turbo", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Temperature" }).click();
  await page.getByRole("spinbutton", { name: "Temperature" }).fill("1");
  await page.getByRole("spinbutton", { name: "Max Tokens" }).click();
  await page.getByRole("spinbutton", { name: "Max Tokens" }).fill("1234");
  await page
    .locator("div")
    .filter({ hasText: /^LLM Config$/ })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "Save Version" }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("save model config");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page
    .locator("div")
    .filter({ hasText: /^Inputs$/ })
    .getByRole("button")
    .click();
  await page.locator('input[name="inputs\\.1\\.identifier"]').click();
  await page.locator('input[name="inputs\\.1\\.identifier"]').fill("test");
  await page
    .locator("div")
    .filter({ hasText: /^Outputs$/ })
    .getByRole("button")
    .click();
  await page.locator('input[name="outputs\\.1\\.identifier"]').click();
  await page
    .locator('input[name="outputs\\.1\\.identifier"]')
    .fill("testoutput");
  await page.getByRole("button", { name: "Save Version" }).click();
  await page.getByRole("textbox", { name: "Description" }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("save inputs and outputs");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .locator('[id="field\\:\\:\\:r1b\\:"] > div > .chakra-button')
    .click();
  await page
    .locator('[id="field\\:\\:\\:r1d\\:"] > div > .chakra-button')
    .click();
  await page.getByRole("button", { name: "Save Version" }).click();
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("save delete inputs outputs");
  await page.getByRole("textbox", { name: "Description" }).press("Enter");
  await page.getByText("Version 4 has been saved").click();
  await page.locator('[id="popover\\:\\:rc\\:\\:trigger"]').click();
  await page
    .locator('[id="popover\\:\\:rc\\:\\:content"]')
    .getByRole("button")
    .nth(2)
    .click();
  await page.getByText("Version restored successfully").click();
  await page
    .getByRole("status", { name: "Version restored successfully" })
    .locator("div")
    .first()
    .click();
  await page
    .getByRole("row", { name: "Updated config name" })
    .getByRole("button")
    .click();
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .fill("d");
  await page.getByRole("textbox", { name: "Type 'delete' to confirm" }).click();
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .fill("delete");
  await page
    .getByRole("textbox", { name: "Type 'delete' to confirm" })
    .press("Enter");
  await page.getByText("No prompt configurations").click();
});
