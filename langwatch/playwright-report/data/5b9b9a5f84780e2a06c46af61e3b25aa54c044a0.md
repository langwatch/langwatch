# Test info

- Name: Create a new workflow
- Location: /Users/hope/workspace/langwatch/langwatch-saas/langwatch/langwatch/e2e/happy-paths/create-workflow.spec.ts:27:5

# Error details

```
Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
Call log:
  - navigating to "http://localhost:5560/fyes-lT_hZ2", waiting until "load"

    at createWorkflow (/Users/hope/workspace/langwatch/langwatch-saas/langwatch/langwatch/e2e/happy-paths/create-workflow.spec.ts:12:14)
    at /Users/hope/workspace/langwatch/langwatch-saas/langwatch/langwatch/e2e/happy-paths/create-workflow.spec.ts:28:9
```

# Test source

```ts
   1 | import { test, expect } from "@playwright/test";
   2 | import type { Page } from "@playwright/test";
   3 |
   4 | test.use({
   5 |   storageState: "./e2e/auth.json",
   6 |   actionTimeout: 120000,
   7 | });
   8 |
   9 | test.setTimeout(120000);
  10 |
  11 | export const createWorkflow = async (page: Page) => {
> 12 |   await page.goto("http://localhost:5560/fyes-lT_hZ2");
     |              ^ Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
  13 |   await page.getByRole("link", { name: "Workflows" }).click();
  14 |   await page.getByTestId("active-create-new-workflow-button").click();
  15 |   await page.getByTestId("new-workflow-card-simple_rag").click();
  16 |   await page.getByRole("textbox", { name: "Name and Icon" }).click();
  17 |   await page
  18 |     .getByRole("textbox", { name: "Name and Icon" })
  19 |     .fill("Test Simple RAG");
  20 |   await page.getByRole("button", { name: "Create Workflow" }).click();
  21 | };
  22 |
  23 | /**
  24 |  * Test happy paths for creating a new workflow
  25 |  * 1. Create a new workflow
  26 |  */
  27 | test("Create a new workflow", async ({ page }) => {
  28 |   await createWorkflow(page);
  29 | });
  30 |
```