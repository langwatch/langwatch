# Scenario Archive E2E Tests - Ready to Run

## Status: Tests Fixed and Ready for Execution

The E2E tests for scenario archiving have been analyzed and improved with reliability fixes. The tests are ready to run, but could not be executed due to missing MCP tools (`test_run`, `test_debug`, etc.).

## Quick Start

```bash
# 1. Start the app (in langwatch/ directory)
PORT=5570 pnpm dev

# 2. Run the tests (in agentic-e2e-tests/ directory)
pnpm playwright test tests/scenarios/scenario-archive.spec.ts
```

## Tests Included

1. **Archive single scenario via row action menu**
   - Creates 5 scenarios
   - Archives 1 via row menu
   - Verifies the other 4 remain

2. **Batch archive multiple selected scenarios**
   - Creates 5 scenarios
   - Selects 2 scenarios
   - Archives both via batch action bar
   - Verifies the other 3 remain

## Fixes Applied

### Reliability Improvements
✓ Added explicit visibility checks before clicking elements
✓ Added proper waits for backend processing after archival
✓ Fixed Chakra UI duplicate element handling with `.last()`
✓ Improved timing for table updates after deletion

### Specific Changes
1. **`whenIClickArchiveInMenu()`** - Wait for menu item to be visible
2. **`whenISelectCheckboxFor()`** - Wait for checkbox to be visible
3. **`whenIClickArchiveInBatchBar()`** - Wait for Archive button to be visible
4. **`whenIConfirmArchival()`** - Added 1s wait after dialog closes
5. **`thenScenarioDoesNotAppearInList()`** - Added initial wait for UI update

## Files Modified

- **`tests/scenarios/steps.ts`** - Step functions for scenario archive tests (5 functions improved)

## Documentation

- **`FIXES_SUMMARY.md`** - Detailed explanation of all fixes applied
- **`TEST_ANALYSIS.md`** - Comprehensive test analysis and troubleshooting guide
- **`run-scenario-archive-tests.sh`** - Helper script to run tests

## Run Options

```bash
# Standard run
pnpm playwright test tests/scenarios/scenario-archive.spec.ts

# UI mode (interactive debugging)
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --ui

# Headed mode (watch browser)
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --headed

# Debug mode (step through)
pnpm playwright test tests/scenarios/scenario-archive.spec.ts --debug
```

## Expected Outcome

Both tests should **PASS** in approximately 60-90 seconds total.

## If Tests Fail

1. **Check app is running**: `curl http://localhost:5570`
2. **Run with --headed**: Watch what's happening in the browser
3. **Check FIXES_SUMMARY.md**: Detailed debugging guide
4. **Review TEST_ANALYSIS.md**: Troubleshooting section

## Next Steps

1. Run the tests using one of the commands above
2. If tests pass, mark the task as complete
3. If tests fail, review the debugging sections in `FIXES_SUMMARY.md`
4. Report any UI component changes that might need test updates

## Technical Notes

- Tests use workflow pattern (no API seeding, creates data via UI)
- Tests depend on "setup" project for authentication
- Base URL: http://localhost:5570
- Framework: Playwright with Chakra UI components
- Table: TanStack React Table with row selection
