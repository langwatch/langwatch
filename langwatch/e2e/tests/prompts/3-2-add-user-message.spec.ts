// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Editing Prompt Content', () => {
  test('Add User Message', async ({ page }) => {
    // 1. Open existing prompt
    await page.goto('/e2e-test-org-1dhzb-project/prompts');
    await page.getByRole('button', { name: /create first prompt/i }).click();
    
    // Save the prompt first
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await page.getByRole('textbox', { name: /prompt identifier/i }).fill('test-assistant');
    await page.getByRole('dialog').getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible();
    
    // 2. Click the "+" button next to "System prompt"
    const addButton = page.getByRole('button').filter({ has: page.locator('img') }).first();
    await addButton.click();
    
    // 3. Select "User" from the dropdown
    await page.getByRole('menuitem', { name: /user/i }).click();
    
    // 4. Type in user message textbox: "What programming languages do you know?"
    const userMessageTextbox = page.getByRole('textbox').last();
    await userMessageTextbox.fill('What programming languages do you know?');
    
    // 5. Observe changes
    // Expected Results:
    // - Dropdown menu appeared with "User" and "Assistant" options
    // (Verified by clicking User option)
    
    // - New user message section is added below system prompt
    await expect(page.getByText('user')).toBeVisible();
    
    // - User message label shows "user"
    await expect(page.getByText('user')).toBeVisible();
    
    // - Delete button appears next to user label
    await expect(page.getByRole('button').filter({ has: page.locator('img') }).last()).toBeVisible();
    
    // - Textbox is empty and ready for input
    await expect(userMessageTextbox).toBeEditable();
    
    // - Save button becomes enabled
    await expect(page.getByRole('button', { name: /^save$/i }).first()).toBeEnabled();
  });
});

