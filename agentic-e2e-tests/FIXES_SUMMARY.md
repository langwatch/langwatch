# Scenario Archive E2E Tests - Fixes Summary

## Overview
Applied fixes to improve reliability and robustness of scenario archive E2E tests based on Playwright best practices and analysis of the UI components.

## Files Modified
- **`tests/scenarios/steps.ts`**: Step function definitions for scenario archive tests

## Fixes Applied

### 1. Added Explicit Waits Before Clicks
**Locations**: Lines 402-406, 442-445, 459-462

**Problem**: Clicking elements without verifying they're visible first can lead to flaky tests, especially with dynamic UI elements.

**Solution**: Added `await expect(element).toBeVisible()` checks before clicking to ensure elements are rendered and interactive.

**Example**:
```typescript
// Before
export async function whenIClickArchiveInMenu(page: Page) {
  await page.getByText("Archive").last().click();
}

// After
export async function whenIClickArchiveInMenu(page: Page) {
  const archiveOption = page.getByText("Archive").last();
  await expect(archiveOption).toBeVisible({ timeout: 5000 });
  await archiveOption.click();
}
```

**Applied to**:
- `whenIClickArchiveInMenu()` - Wait for Archive menu item to be visible
- `whenISelectCheckboxFor()` - Wait for checkbox to be visible
- `whenIClickArchiveInBatchBar()` - Wait for batch Archive button to be visible

### 2. Added `.last()` to Batch Action Bar Archive Button
**Location**: Line 461

**Problem**: Chakra UI renders duplicate dialog elements in the DOM. Without `.last()`, Playwright might interact with a hidden/non-interactive element.

**Solution**: Added `.last()` to ensure we click the visible, active element.

**Code**:
```typescript
const archiveButton = page.getByTestId("batch-action-bar").getByText("Archive").last();
```

### 3. Added Post-Archival Wait Time
**Location**: Lines 420-426

**Problem**: After clicking "Archive" to confirm, the backend needs time to process the deletion and the UI needs time to update. Checking immediately can lead to false failures.

**Solution**: Added a 1-second wait after the dialog closes to allow backend processing and UI refresh.

**Code**:
```typescript
export async function whenIConfirmArchival(page: Page) {
  await page.getByRole("button", { name: "Archive" }).last().click();
  // Wait for dialog to close
  await expect(page.getByText(/Archive.*scenario/).last()).not.toBeVisible({ timeout: 10000 });
  // Wait a moment for the backend to process and UI to update
  await page.waitForTimeout(1000);
}
```

### 4. Improved Scenario Absence Check
**Location**: Lines 431-437

**Problem**: The original implementation might check too early or have issues with multiple elements containing the same text during the transition period.

**Solution**: Added a small initial wait and use `.first()` for more reliable absence checking.

**Code**:
```typescript
export async function thenScenarioDoesNotAppearInList(page: Page, name: string) {
  // Wait for the table to update after deletion
  await page.waitForTimeout(500);
  const scenarioText = page.getByText(name).first();
  await expect(scenarioText).not.toBeVisible({ timeout: 10000 });
}
```

## Test Coverage

### Test 1: Archive Single Scenario via Row Action Menu
**Steps**:
1. Create 5 scenarios via UI (each with unique name)
2. Open row action menu for "Angry double-charge refund"
3. Click "Archive" in menu
4. Verify confirmation modal appears with correct content
5. Confirm archival
6. Verify archived scenario is removed
7. Verify remaining 4 scenarios are still visible

**Duration**: ~30-45 seconds

### Test 2: Batch Archive Multiple Selected Scenarios
**Steps**:
1. Create 5 scenarios with "Batch-" prefix
2. Select 2 scenarios using checkboxes
3. Verify batch action bar appears showing "2 selected"
4. Click "Archive" in batch action bar
5. Verify batch confirmation modal lists both scenarios
6. Confirm archival
7. Verify 2 archived scenarios are removed
8. Verify remaining 3 scenarios are still visible

**Duration**: ~30-45 seconds

## Key Technical Details

### UI Component Structure
- **ScenarioTable**: Uses TanStack React Table with:
  - Row checkboxes: `aria-label="Select {name}"`
  - Action menu buttons: `aria-label="Actions for {name}"`
- **BatchActionBar**: Has `data-testid="batch-action-bar"`
- **ScenarioArchiveDialog**: Chakra UI dialog with:
  - Title: "Archive scenario?" or "Archive N scenarios?"
  - Buttons: "Archive" (red) and "Cancel"
  - Message: "This action can be undone by an administrator."

### Playwright Selectors Used
```typescript
// Row action menu
page.getByLabel("Actions for {name}")

// Row checkbox
page.getByLabel("Select {name}")

// Batch action bar
page.getByTestId("batch-action-bar")

// Dialog elements (use .last() for Chakra duplicates)
page.getByRole("button", { name: "Archive" }).last()
page.getByRole("button", { name: "Cancel" }).last()
page.getByText("Archive scenario?").last()
```

## Running the Tests

### Prerequisites
1. **Start the app on port 5570**:
   ```bash
   cd langwatch
   PORT=5570 pnpm dev
   ```

2. **Install test dependencies**:
   ```bash
   cd agentic-e2e-tests
   pnpm install
   ```

### Run Commands

**Run scenario archive tests only**:
```bash
cd agentic-e2e-tests
pnpm playwright test tests/scenarios/scenario-archive.spec.ts
```

**Run with UI mode (recommended for debugging)**:
```bash
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --ui
```

**Run with headed browser (watch the test execute)**:
```bash
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --headed
```

**Run with debug mode (step through test)**:
```bash
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --debug
```

**Using the helper script**:
```bash
cd agentic-e2e-tests
chmod +x run-scenario-archive-tests.sh
./run-scenario-archive-tests.sh
```

## Expected Results

Both tests should **PASS** with:
- ✓ No timeouts
- ✓ No "element not found" errors
- ✓ Scenarios archived successfully
- ✓ Remaining scenarios visible after archival
- ✓ Total duration: ~60-90 seconds for both tests

## Debugging Failed Tests

### If Test Times Out
1. Check if app is running: `curl http://localhost:5570`
2. Verify database is accessible
3. Check browser console logs (use `--headed` mode)
4. Increase timeout values if system is slow

### If "Element Not Found" Errors
1. Run with `--headed` to watch the test
2. Check if UI component structure changed
3. Verify aria-labels match the code
4. Use browser dev tools to inspect actual elements

### If Scenarios Don't Disappear After Archival
1. Increase wait time in `whenIConfirmArchival()` (line 425)
2. Check network tab for failed API requests
3. Verify backend archival logic is working
4. Check if table is re-fetching data correctly

### If Tests Are Flaky
1. Increase all timeout values by 50%
2. Add more explicit waits before assertions
3. Check for race conditions in scenario creation
4. Consider adding network idle waits (but use sparingly)

## Playwright Best Practices Applied

✓ **Explicit waits**: Wait for elements to be visible before interacting
✓ **Use `.last()`**: Handle Chakra UI duplicate elements
✓ **Specific selectors**: Use aria-labels and test-ids over generic text
✓ **Reasonable timeouts**: 5-10 second timeouts for most operations
✓ **Clear step functions**: Each step is a single, testable action
✓ **Avoid deprecated APIs**: No networkidle or other discouraged patterns

## Notes
- Tests use workflow pattern (create data via UI, no API seeding)
- Tests depend on "setup" project for authentication
- Each test is independent and creates its own data
- Tests run sequentially (workers: 1) for debugging reliability

## Related Files
- **Test spec**: `tests/scenarios/scenario-archive.spec.ts`
- **Step definitions**: `tests/scenarios/steps.ts` (this file)
- **UI components**:
  - `langwatch/src/components/scenarios/ScenarioTable.tsx`
  - `langwatch/src/components/scenarios/BatchActionBar.tsx`
  - `langwatch/src/components/scenarios/ScenarioArchiveDialog.tsx`
- **Integration tests**: `langwatch/src/components/scenarios/__tests__/ScenarioTable.integration.test.tsx`
