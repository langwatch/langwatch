// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Editing Prompt Content", () => {
  test("Modify System Prompt", async ({ page }) => {
    // 1. Open existing prompt
    await page.goto("/e2e-test-org-1dhzb-project/prompts");
    await page.getByRole("button", { name: /create first prompt/i }).click();

    // Save the prompt first
    await page
      .getByRole("button", { name: /^save$/i })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: /prompt identifier/i })
      .fill("test-assistant");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /save/i })
      .click();

    // Wait for save to complete
    await expect(page.getByRole("button", { name: /saved/i })).toBeVisible();

    // 2. Click in the system prompt textbox
    const systemPromptTextbox = page
      .getByRole("textbox")
      .filter({ hasText: "You are a helpful assistant." });
    await systemPromptTextbox.click();

    // 3. Clear existing text
    await systemPromptTextbox.clear();

    // 4. Type new system message: "You are an expert software developer"
    await systemPromptTextbox.fill("You are an expert software developer");

    // 5. Observe Save button state
    // Expected Results:
    // - System prompt textbox is editable
    await expect(systemPromptTextbox).toBeEditable();

    // - Text updates in real-time
    await expect(systemPromptTextbox).toHaveValue(
      "You are an expert software developer",
    );

    // - Save button becomes enabled (changes from "Saved" to "Save")
    await expect(
      page.getByRole("button", { name: /^save$/i }).first(),
    ).toBeEnabled();

    // - Draft state is indicated
    await expect(
      page.getByRole("button", { name: /^save$/i }).first(),
    ).toBeVisible();
  });
});
