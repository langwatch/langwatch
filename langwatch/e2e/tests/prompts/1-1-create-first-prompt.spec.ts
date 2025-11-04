// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Creating a New Prompt', () => {
  test('Create First Prompt from Empty State', async ({ page }) => {
    // 1. Navigate to `/prompts` page with no existing prompts
    await page.goto('/e2e-test-org-1dhzb-project/prompts');
    
    // 2. Verify "No prompts yet" message is displayed
    await expect(page.getByText('No prompts yet')).toBeVisible();
    
    // 3. Click "Create First Prompt" button
    await page.getByRole('button', { name: /create first prompt/i }).click();
    
    // 4. Verify prompt playground opens with default configuration
    // Expected Results:
    // - Empty prompt titled "Untitled" is created
    await expect(page.getByText('Untitled')).toBeVisible();
    
    // - Default system prompt shows "You are a helpful assistant."
    await expect(page.getByRole('textbox').filter({ hasText: 'You are a helpful assistant.' })).toBeVisible();
    
    // - Default model is "gpt-5"
    await expect(page.getByText('gpt-5')).toBeVisible();
    
    // - Single tab is created in the workspace
    await expect(page.getByRole('tab', { name: /untitled/i })).toBeVisible();
    
    // - Save button is visible (enabled for new prompts)
    await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible();
    
    // - Conversation and Settings tabs are visible
    await expect(page.getByRole('tab', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    
    // - Chat interface is ready for interaction
    await expect(page.getByPlaceholder('Type your message here')).toBeVisible();
  });
});

