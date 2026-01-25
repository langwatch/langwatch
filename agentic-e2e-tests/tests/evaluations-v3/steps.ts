/**
 * Step definitions for Evaluations V3 HTTP Agent feature tests
 *
 * These functions are named to match Gherkin language from feature files:
 * - specs/evaluations-v3/http-agent-support.feature
 *
 * Usage: Import and compose these steps in test files to create
 * readable tests that map directly to feature specifications.
 */
import { Page, expect } from "@playwright/test";

// =============================================================================
// Navigation Steps
// =============================================================================

/**
 * Given I am on the evaluations page
 */
export async function givenIAmOnTheEvaluationsPage(page: Page) {
  await page.goto("/");

  // Wait for the sidebar Home link to appear (indicates app is loaded)
  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeLink).toBeVisible({ timeout: 30000 });

  const href = await homeLink.getAttribute("href");
  const projectSlug = href?.replace(/^\//, "") || "";

  if (!projectSlug) {
    throw new Error("Could not extract project slug from Home link");
  }

  await page.goto(`/${projectSlug}/evaluations`);
  await expect(page).toHaveURL(/evaluations/);
}

/**
 * When I click "New Evaluation" dropdown and select "Experiment"
 */
export async function whenICreateNewExperiment(page: Page) {
  // Click the dropdown button
  await page.getByRole("button", { name: /new evaluation/i }).click();

  // Select "Experiment" from the menu
  await page.getByRole("menuitem", { name: /experiment/i }).click();

  // Wait for redirect to workbench
  await expect(page).toHaveURL(/experiments\/workbench\//, { timeout: 15000 });
}

// =============================================================================
// Target Configuration Steps
// =============================================================================

/**
 * When I click "Add" button in targets section
 */
export async function whenIClickAddTarget(page: Page) {
  // Look for the Add button in the "Prompts or Agents" section
  const addButton = page.getByRole("button", { name: /^add$/i }).first();
  await addButton.click();
}

/**
 * When I select "Agent" from target type selector
 */
export async function whenISelectAgentTargetType(page: Page) {
  const agentCard = page.locator('[data-testid="target-type-agent"]');
  await expect(agentCard).toBeVisible({ timeout: 5000 });
  await agentCard.click();
}

/**
 * When I click "New Agent" button
 */
export async function whenIClickNewAgent(page: Page) {
  const newAgentButton = page.locator('[data-testid="new-agent-button"]');
  await expect(newAgentButton).toBeVisible({ timeout: 5000 });
  await newAgentButton.click();
}

/**
 * When I select "HTTP Agent" type
 */
export async function whenISelectHTTPAgentType(page: Page) {
  const httpAgentCard = page.locator('[data-testid="agent-type-http"]');
  await expect(httpAgentCard).toBeVisible({ timeout: 5000 });
  await httpAgentCard.click();
}

/**
 * When I configure HTTP agent with name, method, URL, body template, and output path
 */
export async function whenIConfigureHTTPAgent(
  page: Page,
  config: {
    name: string;
    method: string;
    url: string;
    bodyTemplate: string;
    outputPath: string;
  }
) {
  // Fill in agent name
  const nameInput = page.locator('[data-testid="agent-name-input"]').last();
  await nameInput.fill(config.name);

  // Select method (if different from default POST)
  if (config.method !== "POST") {
    const methodSelect = page.getByRole("combobox", { name: /method/i }).last();
    await methodSelect.selectOption(config.method);
  }

  // Fill in URL
  const urlInput = page.locator('[data-testid="url-input"]').last();
  await urlInput.fill(config.url);

  // Fill in body template
  const bodyInput = page.getByLabel(/body template/i).last();
  await bodyInput.fill(config.bodyTemplate);

  // Fill in output path
  const outputPathInput = page.getByLabel(/output path/i).last();
  await outputPathInput.fill(config.outputPath);
}

/**
 * When I click "Create Agent" or "Save Agent"
 */
export async function whenIClickCreateAgent(page: Page) {
  const saveButton = page.locator('[data-testid="save-agent-button"]').last();
  await saveButton.click();

  // Wait for drawer to close
  await expect(saveButton).not.toBeVisible({ timeout: 10000 });
}

// =============================================================================
// Dataset Steps
// =============================================================================

/**
 * When I add dataset row with input and expected_output
 */
export async function whenIAddDatasetRow(
  page: Page,
  rowIndex: number,
  input: string,
  expectedOutput: string
) {
  // Click on input cell
  const inputCell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="input"]`
    )
    .last();
  await inputCell.click();

  // Type into the input cell
  const inputTextbox = page.locator('textarea, input[type="text"]').last();
  await inputTextbox.fill(input);
  await inputTextbox.press("Enter");

  // Click on expected_output cell
  const expectedCell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="expected_output"]`
    )
    .last();
  await expectedCell.click();

  // Type into the expected_output cell
  const expectedTextbox = page.locator('textarea, input[type="text"]').last();
  await expectedTextbox.fill(expectedOutput);
  await expectedTextbox.press("Enter");
}

// =============================================================================
// Evaluator Steps
// =============================================================================

/**
 * When I add exact_match evaluator
 */
export async function whenIAddExactMatchEvaluator(page: Page) {
  // Click Add Evaluator button
  const addEvaluatorButton = page
    .getByRole("button", { name: /add.*evaluator/i })
    .last();
  await addEvaluatorButton.click();

  // Select exact_match from list
  const exactMatchOption = page
    .getByText("exact_match", { exact: true })
    .last();
  await exactMatchOption.click();
}

/**
 * When I configure evaluator mappings
 */
export async function whenIConfigureEvaluatorMappings(
  page: Page,
  config: { output: string; expected: string }
) {
  // This would configure the evaluator to compare target.output vs dataset.expected_output
  // Implementation depends on actual UI - may need to select from dropdowns
  const outputSelect = page.getByLabel(/output/i).last();
  await outputSelect.selectOption(config.output);

  const expectedSelect = page.getByLabel(/expected/i).last();
  await expectedSelect.selectOption(config.expected);
}

// =============================================================================
// Execution Steps
// =============================================================================

/**
 * When I click "Evaluate" button
 */
export async function whenIClickEvaluate(page: Page) {
  const evaluateButton = page
    .getByRole("button", { name: /^evaluate$/i })
    .last();
  await evaluateButton.click();
}

/**
 * When I wait for evaluation to complete
 */
export async function whenIWaitForEvaluationComplete(
  page: Page,
  rowCount: number
) {
  // Wait for all rows to complete execution
  for (let i = 0; i < rowCount; i++) {
    // Wait for loading skeletons to disappear
    const loadingIndicator = page.locator(
      `[data-row="${i}"] [data-testid="loading-skeleton"]`
    );
    await expect(loadingIndicator).not.toBeVisible({ timeout: 30000 });
  }
}

/**
 * When I click play button on specific cell
 */
export async function whenIClickPlayButtonOnCell(
  page: Page,
  rowIndex: number,
  columnId: string
) {
  const cell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="${columnId}"]`
    )
    .last();
  await cell.hover();

  const playButton = cell.locator('[data-testid="cell-play-button"]');
  await playButton.click();
}

/**
 * When I modify dataset row input
 */
export async function whenIModifyDatasetRowInput(
  page: Page,
  rowIndex: number,
  newInput: string
) {
  const inputCell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="input"]`
    )
    .last();
  await inputCell.click();

  const inputTextbox = page.locator('textarea, input[type="text"]').last();
  await inputTextbox.clear();
  await inputTextbox.fill(newInput);
  await inputTextbox.press("Enter");
}

// =============================================================================
// Verification Steps
// =============================================================================

/**
 * Then all target cells show echoed output
 */
export async function thenTargetCellsShowOutput(
  page: Page,
  targetColumnId: string,
  expectedOutputs: string[]
) {
  for (let i = 0; i < expectedOutputs.length; i++) {
    const cell = page
      .locator(
        `[data-testid="spreadsheet-cell"][data-row="${i}"][data-column="${targetColumnId}"]`
      )
      .last();
    await expect(cell).toContainText(expectedOutputs[i], { timeout: 15000 });
  }
}

/**
 * Then evaluator cells show pass status
 */
export async function thenEvaluatorCellsShowPass(
  page: Page,
  evaluatorColumnId: string,
  rowCount: number
) {
  for (let i = 0; i < rowCount; i++) {
    // Look for green checkmark or "pass" indicator
    const cell = page
      .locator(
        `[data-testid="spreadsheet-cell"][data-row="${i}"][data-column="${evaluatorColumnId}"]`
      )
      .last();
    const passIndicator = cell.locator(
      '[data-testid="evaluation-pass"], .chakra-icon[data-status="pass"]'
    );
    await expect(passIndicator).toBeVisible({ timeout: 15000 });
  }
}

/**
 * Then target header shows aggregate pass rate
 */
export async function thenTargetHeaderShowsPassRate(
  page: Page,
  expectedRate: string | RegExp
) {
  const headerPassRate = page.getByText(expectedRate);
  await expect(headerPassRate).toBeVisible({ timeout: 10000 });
}

/**
 * Then only specific row shows loading
 */
export async function thenOnlyRowShowsLoading(page: Page, rowIndex: number) {
  const loadingCell = page
    .locator(`[data-row="${rowIndex}"] [data-testid="loading-skeleton"]`)
    .last();
  await expect(loadingCell).toBeVisible({ timeout: 5000 });
}

/**
 * Then other rows remain unchanged
 */
export async function thenOtherRowsRemainUnchanged(
  page: Page,
  unchangedRows: number[],
  columnId: string,
  expectedOutputs: string[]
) {
  for (let i = 0; i < unchangedRows.length; i++) {
    const rowIndex = unchangedRows[i];
    const cell = page
      .locator(
        `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="${columnId}"]`
      )
      .last();
    await expect(cell).toContainText(expectedOutputs[i], { timeout: 5000 });
  }
}

/**
 * Then specific cell shows updated output
 */
export async function thenCellShowsOutput(
  page: Page,
  rowIndex: number,
  columnId: string,
  expectedOutput: string
) {
  const cell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="${columnId}"]`
    )
    .last();
  await expect(cell).toContainText(expectedOutput, { timeout: 15000 });
}

/**
 * Then evaluator shows fail status for specific row
 */
export async function thenEvaluatorShowsFailForRow(
  page: Page,
  rowIndex: number,
  evaluatorColumnId: string
) {
  const cell = page
    .locator(
      `[data-testid="spreadsheet-cell"][data-row="${rowIndex}"][data-column="${evaluatorColumnId}"]`
    )
    .last();
  const failIndicator = cell.locator(
    '[data-testid="evaluation-fail"], .chakra-icon[data-status="fail"]'
  );
  await expect(failIndicator).toBeVisible({ timeout: 15000 });
}
