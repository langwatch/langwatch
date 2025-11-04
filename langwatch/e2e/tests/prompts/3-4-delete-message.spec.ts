// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Editing Prompt Content', () => {
  test('Delete Message', async ({ page }) => {
    // Setup: Create prompt with user and assistant messages
    await page.goto('/e2e-test-org-1dhzb-project/prompts');
    await page.getByRole('button', { name: /create first prompt/i }).click();
    
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await page.getByRole('textbox', { name: /prompt identifier/i }).fill('test-assistant');
    await page.getByRole('dialog').getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible();
    
    // Add user message
    let addButton = page.getByRole('button').filter({ has: page.locator('img') }).first();
    await addButton.click();
    await page.getByRole('menuitem', { name: /user/i }).click();
    await page.getByRole('textbox').last().fill('Test user message');
    
    // Save to establish a saved version
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible();
    
    // 1. Click delete button next to a user message
    const deleteButton = page.getByRole('button').filter({ has: page.locator('img') }).last();
    await deleteButton.click();
    
    // 2. Observe message removal
    // Expected Results:
    // - Message is immediately removed
    await expect(page.getByText('Test user message')).not.toBeVisible();
    
    // - Remaining messages reflow
    const messages = page.getByRole('group');
    await expect(messages).toHaveCount(1); // Only system prompt remains
    
    // - Save button becomes enabled if saved version existed
    await expect(page.getByRole('button', { name: /^save$/i }).first()).toBeEnabled();
  });
});

