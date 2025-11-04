// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Saving a Prompt", () => {
  test("Save New Prompt with Identifier", async ({ page }) => {
    // 1. Create a new prompt (from scenario 1.1)
    await page.goto("/e2e-test-org-1dhzb-project/prompts");

    // Click either "Create First Prompt" or the "+" button if prompts exist
    const createButton = page.getByRole("button", {
      name: /create first prompt/i,
    });
    const plusButton = page.getByRole("navigation").getByRole("button").first();

    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createButton.click();
    } else {
      await plusButton.click();
    }

    // 2. Click "Save" button
    const saveButton = page.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click();

    // 3. Wait for dialog and enter identifier: "test-assistant"
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });

    const identifierInput = dialog.getByRole("textbox", { name: /handle/i });
    await identifierInput.waitFor({ state: "visible" });
    await identifierInput.fill("test-assistant");

    // 4. Verify Project scope is selected
    await expect(dialog.getByText(/project/i)).toBeVisible();

    // 5. Click "Save" in the dialog
    const dialogSaveButton = dialog.getByRole("button", { name: /^save$/i });
    await dialogSaveButton.waitFor({ state: "visible" });
    await dialogSaveButton.click();

    // Expected Results:
    // - Save Prompt dialog appeared with required fields
    // - After entering identifier, Save button became enabled
    // - After saving:

    // - Prompt appears in left sidebar with identifier name
    await expect(
      page.getByRole("navigation").getByText("test-assistant"),
    ).toBeVisible();

    // - Tab title updates from "Untitled" to identifier
    await expect(
      page.getByRole("tab", { name: /test-assistant/i }),
    ).toBeVisible();

    // - Version indicator shows "v1"
    await expect(page.getByText("v1")).toBeVisible();

    // - Save button changes to "Saved" and becomes disabled
    await expect(page.getByRole("button", { name: /saved/i })).toBeDisabled();

    // - API button becomes enabled
    await expect(page.getByRole("button", { name: /api/i })).toBeEnabled();
  });
});
