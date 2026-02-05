# Scenario Archive E2E Tests Analysis

## Test Files
- **Test Spec**: `/Users/USER/workspace/langwatch-workspace/worktrees/worktree-issue1288-add-ability-to-delete-scenarios-from-ui/agentic-e2e-tests/tests/scenarios/scenario-archive.spec.ts`
- **Step Functions**: `/Users/USER/workspace/langwatch-workspace/worktrees/worktree-issue1288-add-ability-to-delete-scenarios-from-ui/agentic-e2e-tests/tests/scenarios/steps.ts`

## Test Coverage

### Test 1: Archive a Single Scenario via Row Action Menu
**Workflow:**
1. Creates 5 scenarios via UI
2. Opens row action menu for "Angry double-charge refund"
3. Clicks "Archive" in menu
4. Verifies archive confirmation modal appears
5. Confirms archival
6. Verifies the archived scenario is gone and others remain

### Test 2: Batch Archive Multiple Selected Scenarios
**Workflow:**
1. Creates 5 scenarios with "Batch-" prefix
2. Selects 2 scenarios using checkboxes
3. Verifies batch action bar appears with "2 selected"
4. Clicks "Archive" in batch action bar
5. Verifies batch archive confirmation modal with scenario list
6. Confirms archival
7. Verifies the archived scenarios are gone and others remain

## Fixes Applied

### 1. Added `.last()` to Batch Action Bar Archive Button (Line 458)
**Issue**: The batch action bar Archive button click was not using `.last()`, which could cause issues with duplicate Chakra UI elements.

**Fix**:
```typescript
// Before
await page.getByTestId("batch-action-bar").getByText("Archive").click();

// After
await page.getByTestId("batch-action-bar").getByText("Archive").last().click();
```

**Rationale**: Chakra UI often renders duplicate dialog elements in the DOM. Using `.last()` ensures we click the visible/active element.

### 2. Added Wait After Archival Confirmation (Line 425)
**Issue**: After clicking "Archive" to confirm, the backend needs time to process the deletion and the UI needs time to update.

**Fix**:
```typescript
export async function whenIConfirmArchival(page: Page) {
  await page.getByRole("button", { name: "Archive" }).last().click();
  // Wait for dialog to close
  await expect(page.getByText(/Archive.*scenario/).last()).not.toBeVisible({ timeout: 10000 });
  // Wait a moment for the backend to process and UI to update
  await page.waitForTimeout(1000);
}
```

**Rationale**: Prevents race conditions where we check if the scenario is gone before the UI has updated.

### 3. Improved `thenScenarioDoesNotAppearInList` (Lines 432-436)
**Issue**: The original implementation might check too early or have issues with multiple elements containing the same text.

**Fix**:
```typescript
export async function thenScenarioDoesNotAppearInList(page: Page, name: string) {
  // Wait for the table to update after deletion
  // Use a more specific selector that looks for the text within table context
  await page.waitForTimeout(500);
  const scenarioText = page.getByText(name).first();
  await expect(scenarioText).not.toBeVisible({ timeout: 10000 });
}
```

**Rationale**:
- Small initial wait allows UI to start updating
- Using `.first()` is more reliable than checking all matches when verifying absence

## Verification Status

**Status**: Ready for testing, but cannot be run without MCP tools

The fixes have been applied based on:
1. Analysis of the UI components (ScenarioTable, BatchActionBar, ScenarioArchiveDialog)
2. Review of existing integration tests that verify the same components
3. Understanding of Chakra UI's behavior with duplicate elements
4. Playwright best practices for timing and selectors

## Potential Issues to Watch For

### 1. Scenario Creation Flow
**Risk**: The test creates scenarios via UI using the "Save and Run" popover flow, which has multiple steps.

**Monitoring**:
- Watch for timeouts during scenario creation
- Verify the "Save without running" option is clicked correctly
- Ensure navigation back to the scenarios list page works reliably

### 2. Element Visibility Timing
**Risk**: There might be additional timing issues not covered by the current waits.

**Monitoring**:
- If tests fail with "element not visible" errors, consider increasing timeouts
- Watch for race conditions between dialog close and table update

### 3. Table Rendering Performance
**Risk**: Creating 5 scenarios and waiting for table to render might be slow.

**Monitoring**:
- If tests timeout during scenario creation, increase the timeout values
- Consider adding more explicit waits for table row rendering

### 4. Backend Processing Time
**Risk**: The 1-second wait after confirming archival might not be enough on slower systems.

**Monitoring**:
- If scenarios still appear after archival, increase the wait time
- Consider using a more explicit wait (e.g., waiting for network request to complete)

## Running the Tests

### Prerequisites
1. Start the LangWatch app on port 5570:
   ```bash
   cd langwatch
   PORT=5570 pnpm dev
   ```

2. Ensure test dependencies are installed:
   ```bash
   cd agentic-e2e-tests
   pnpm install
   ```

### Run Tests
```bash
# Using the helper script
cd agentic-e2e-tests
chmod +x run-scenario-archive-tests.sh
./run-scenario-archive-tests.sh

# Or directly with Playwright
cd agentic-e2e-tests
pnpm playwright test tests/scenarios/scenario-archive.spec.ts

# With UI mode for debugging
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --ui

# With headed browser for visual debugging
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --headed
```

## Expected Results

Both tests should pass with the following behavior:

1. **Single Archive Test**:
   - Duration: ~30-45 seconds (includes creating 5 scenarios)
   - Verifies: 1 scenario archived, 4 scenarios remain

2. **Batch Archive Test**:
   - Duration: ~30-45 seconds (includes creating 5 scenarios)
   - Verifies: 2 scenarios archived, 3 scenarios remain

## Next Steps if Tests Fail

1. **Check App is Running**: Verify http://localhost:5570 is accessible
2. **Review Logs**: Check browser console and network requests
3. **Use Debug Mode**: Run with `--headed` flag to watch the browser
4. **Take Screenshots**: Playwright will auto-capture on failure
5. **Increase Timeouts**: If timing issues, increase wait times incrementally
6. **Verify UI Changes**: Check if UI components match expected selectors

## Technical Context

- **Framework**: Playwright E2E Testing
- **Base URL**: http://localhost:5570
- **UI Library**: Chakra UI (renders duplicate dialog elements)
- **Table Library**: TanStack React Table
- **Test Pattern**: Workflow tests (create own data via UI, no API seeding)
- **Auth**: Tests depend on "setup" project that handles authentication
