// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Editing Prompt Content', () => {
  test('Add Assistant Message', async ({ page }) => {
    // Setup: Create prompt with user message
    await page.goto('/e2e-test-org-1dhzb-project/prompts');
    await page.getByRole('button', { name: /create first prompt/i }).click();
    
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await page.getByRole('textbox', { name: /prompt identifier/i }).fill('test-assistant');
    await page.getByRole('dialog').getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible();
    
    // Add user message first
    const addButton = page.getByRole('button').filter({ has: page.locator('img') }).first();
    await addButton.click();
    await page.getByRole('menuitem', { name: /user/i }).click();
    
    // 1. From scenario 3.2, click "+" button again
    await addButton.click();
    
    // 2. Select "Assistant" from dropdown
    await page.getByRole('menuitem', { name: /assistant/i }).click();
    
    // 3. Type assistant message: "I can help you with a variety of tasks!"
    const assistantMessageTextbox = page.getByRole('textbox').last();
    await assistantMessageTextbox.fill('I can help you with a variety of tasks!');
    
    // 4. Observe the message structure
    // Expected Results:
    // - Assistant message section is added
    await expect(page.getByText('assistant')).toBeVisible();
    
    // - Assistant message label shows "assistant"
    await expect(page.getByText('assistant')).toBeVisible();
    
    // - Delete button appears next to assistant label
    await expect(page.getByRole('button').filter({ has: page.locator('img') }).last()).toBeVisible();
    
    // - Messages are ordered: System → User → Assistant
    const messages = page.getByRole('group');
    await expect(messages).toHaveCount(3); // system, user, assistant
    
    // - Save button remains enabled
    await expect(page.getByRole('button', { name: /^save$/i }).first()).toBeEnabled();
  });
});

