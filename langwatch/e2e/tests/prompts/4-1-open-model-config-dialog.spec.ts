// spec: e2e/specs/prompts-comprehensive-test-plan.md
// seed: e2e/seed.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Model Configuration', () => {
  test('Open Model Configuration Dialog', async ({ page }) => {
    // Setup: Create a prompt
    await page.goto('/e2e-test-org-1dhzb-project/prompts');
    await page.getByRole('button', { name: /create first prompt/i }).click();
    
    // 1. Click on the model dropdown showing "gpt-5"
    await page.getByText('gpt-5').click();
    
    // 2. Observe the LLM Config dialog
    // Expected Results:
    // - "LLM Config" dialog opens
    await expect(page.getByRole('dialog').getByText('LLM Config')).toBeVisible();
    
    // - Shows three configuration sections:
    // - Model selector (dropdown with current model)
    await expect(page.getByRole('combobox', { name: /model/i })).toBeVisible();
    
    // - Temperature (with description)
    await expect(page.getByText(/temperature/i)).toBeVisible();
    
    // - Max Tokens (with description)
    await expect(page.getByText(/max tokens/i)).toBeVisible();
    
    // - Link to model providers settings is visible
    await expect(page.getByRole('link', { name: /model providers/i })).toBeVisible();
    
    // - Close button is present
    await expect(page.getByRole('button', { name: /close/i })).toBeVisible();
  });
});

