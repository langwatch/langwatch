# Test Plan: Scenario Archiving

**Feature specification:** `specs/scenarios/scenario-deletion.feature`

## Overview

This test plan covers the scenario archiving feature, which allows LangWatch users to remove scenarios from the active scenario library. Users can archive scenarios individually via a row action menu or in batch via row selection checkboxes and a batch action bar. Both paths present a confirmation dialog before executing the archive operation.

**Key UI components:**
- **ScenarioTable** -- TanStack React Table with per-row checkboxes (`aria-label="Select {name}"`) and row action menus (`aria-label="Actions for {name}"`)
- **BatchActionBar** -- Appears when checkboxes are selected, shows "{N} selected" and an "Archive" button (`data-testid="batch-action-bar"`)
- **ScenarioArchiveDialog** -- Confirmation dialog with "Cancel" and "Archive" buttons

**Workflow test pattern:** Since there is no API seeding available, these tests follow a workflow pattern: create the required scenarios via the UI first, then test the archive functionality.

**Chakra UI note:** Chakra renders duplicate dialog elements. Always use `.last()` when querying dialog content.

---

## Existing Step Functions (from `tests/scenarios/steps.ts`)

The following steps are already implemented and should be reused:

| Step Function | Purpose |
|---|---|
| `givenIAmLoggedIntoProject(page)` | Navigate to `/` and ensure authenticated |
| `givenIAmOnTheScenariosListPage(page)` | Navigate to `/{project}/simulations/scenarios` |
| `whenIClickNewScenario(page)` | Click "New Scenario" button |
| `whenIFillInNameWith(page, name)` | Fill the Name field in scenario editor |
| `whenIFillInSituationWith(page, situation)` | Fill the Situation field |
| `whenIClickSave(page)` | Save via "Save and Run" > "Save without running" |
| `thenScenarioAppearsInList(page, name)` | Assert scenario name visible in list |

---

## New Step Functions Required

These steps must be implemented to support the archive test scenarios:

### `whenIOpenRowActionMenuFor(page, scenarioName)`

Opens the three-dot (MoreVertical) menu on a specific scenario row.

```
Locator: page.getByLabel(`Actions for ${scenarioName}`)
Action: .click()
```

### `whenIClickArchiveInMenu(page)`

Clicks the "Archive" option inside the open row action menu.

```
Locator: page.getByText("Archive").last()
Action: .click()
Note: Menu.Content uses portalled={false}, so Archive text is within the table DOM
```

### `thenISeeArchiveConfirmationModal(page, scenarioName)`

Verifies the single-scenario confirmation dialog is visible with the correct scenario name.

```
Assertions:
  - page.getByText("Archive scenario?").last() is visible
  - page.getByText(scenarioName).last() is visible
  - page.getByText("This action can be undone by an administrator.").last() is visible
  - page.getByRole("button", { name: "Archive" }).last() is visible
  - page.getByRole("button", { name: "Cancel" }).last() is visible
```

### `whenIConfirmArchival(page)`

Clicks the "Archive" button inside the confirmation dialog.

```
Locator: page.getByRole("button", { name: "Archive" }).last()
Action: .click()
Post-condition: Wait for dialog to close (button becomes not visible, timeout 10s)
```

### `thenScenarioDoesNotAppearInList(page, name)`

Verifies a scenario name is no longer visible in the scenarios list.

```
Assertion: expect(page.getByText(name)).not.toBeVisible({ timeout: 10000 })
```

### `whenISelectCheckboxFor(page, name)`

Checks the row selection checkbox for a specific scenario.

```
Locator: page.getByLabel(`Select ${name}`)
Action: .click()
```

### `thenISeeTheBatchActionBar(page, count)`

Verifies the batch action bar is visible with the correct selection count.

```
Assertions:
  - page.getByTestId("batch-action-bar") is visible
  - page.getByText(`${count} selected`) is visible
```

### `whenIClickArchiveInBatchBar(page)`

Clicks the "Archive" button inside the batch action bar.

```
Locator: page.getByTestId("batch-action-bar").getByText("Archive")
Action: .click()
```

### `thenISeeArchiveConfirmationModalListing(page, names[])`

Verifies the batch archive confirmation dialog is visible and lists all scenario names.

```
Assertions:
  - page.getByText(`Archive ${names.length} scenarios?`).last() is visible
  - For each name in names: page.getByText(name).last() is visible
  - page.getByText("This action can be undone by an administrator.").last() is visible
```

---

## Suite 1: Single Scenario Archive via Row Action Menu

**File:** `tests/scenarios/scenario-archive.spec.ts`

### Test: Archive a single scenario via row action menu

This is a workflow test that creates 5 scenarios, then archives one via the row action menu.

**Setup phase -- create 5 scenarios:**

1. Call `givenIAmLoggedIntoProject(page)`
2. Call `givenIAmOnTheScenariosListPage(page)`
3. For each of the following 5 scenario names, create a scenario:
   - "Angry double-charge refund"
   - "Cross-doc synthesis question"
   - "Failed booking escalation"
   - "SaaS documentation guidance"
   - "HTTP troubleshooting request"
4. For each scenario creation:
   a. Call `whenIClickNewScenario(page)`
   b. Call `whenIFillInNameWith(page, name)`
   c. Call `whenIFillInSituationWith(page, "Test situation for archive e2e")`
   d. Call `whenIClickSave(page)`
   e. Call `givenIAmOnTheScenariosListPage(page)` (navigate back to list)
   f. Call `thenScenarioAppearsInList(page, name)` (verify creation)

**Archive phase:**

5. Call `whenIOpenRowActionMenuFor(page, "Angry double-charge refund")`
6. Call `whenIClickArchiveInMenu(page)`
7. Call `thenISeeArchiveConfirmationModal(page, "Angry double-charge refund")`
8. Call `whenIConfirmArchival(page)`

**Verification phase:**

9. Call `thenScenarioDoesNotAppearInList(page, "Angry double-charge refund")`
10. Verify the remaining 4 scenarios are still visible:
    - Call `thenScenarioAppearsInList(page, "Cross-doc synthesis question")`
    - Call `thenScenarioAppearsInList(page, "Failed booking escalation")`
    - Call `thenScenarioAppearsInList(page, "SaaS documentation guidance")`
    - Call `thenScenarioAppearsInList(page, "HTTP troubleshooting request")`

---

## Suite 2: Batch Archive via Row Selection

**File:** `tests/scenarios/scenario-archive.spec.ts` (same file, separate test)

### Test: Batch archive multiple selected scenarios

This is a workflow test that creates 5 scenarios, then archives 2 of them via batch selection.

**Setup phase -- create 5 scenarios:**

1. Call `givenIAmLoggedIntoProject(page)`
2. Call `givenIAmOnTheScenariosListPage(page)`
3. Create 5 scenarios with unique names (use "Batch-" prefix):
   - "Batch-Cross-doc synthesis question"
   - "Batch-Failed booking escalation"
   - "Batch-SaaS documentation guidance"
   - "Batch-HTTP troubleshooting request"
   - "Batch-Angry double-charge refund"

**Selection phase:**

5. Call `whenISelectCheckboxFor(page, "Batch-Cross-doc synthesis question")`
6. Call `whenISelectCheckboxFor(page, "Batch-Failed booking escalation")`
7. Call `thenISeeTheBatchActionBar(page, 2)`

**Archive phase:**

8. Call `whenIClickArchiveInBatchBar(page)`
9. Call `thenISeeArchiveConfirmationModalListing(page, ["Batch-Cross-doc synthesis question", "Batch-Failed booking escalation"])`
10. Call `whenIConfirmArchival(page)`

**Verification phase:**

11. Call `thenScenarioDoesNotAppearInList(page, "Batch-Cross-doc synthesis question")`
12. Call `thenScenarioDoesNotAppearInList(page, "Batch-Failed booking escalation")`
13. Verify the remaining 3 scenarios are still visible:
    - Call `thenScenarioAppearsInList(page, "Batch-SaaS documentation guidance")`
    - Call `thenScenarioAppearsInList(page, "Batch-HTTP troubleshooting request")`
    - Call `thenScenarioAppearsInList(page, "Batch-Angry double-charge refund")`
14. Verify the batch action bar is gone:
    - `expect(page.getByTestId("batch-action-bar")).not.toBeVisible()`

---

## Implementation Notes

### Locator Strategy

| Element | Locator |
|---|---|
| Row action menu button | `page.getByLabel("Actions for {name}")` |
| Row checkbox | `page.getByLabel("Select {name}")` |
| Select all checkbox | `page.getByLabel("Select all")` |
| Batch action bar | `page.getByTestId("batch-action-bar")` |
| Archive menu item | `page.getByText("Archive")` (within menu context) |
| Dialog title (single) | `page.getByText("Archive scenario?").last()` |
| Dialog title (batch) | `page.getByText("Archive N scenarios?").last()` |
| Dialog Archive button | `page.getByRole("button", { name: "Archive" }).last()` |
| Dialog Cancel button | `page.getByRole("button", { name: "Cancel" }).last()` |

### Important Technical Details

1. **Chakra UI duplicate elements:** The Dialog component renders duplicate DOM elements. Always use `.last()` when querying dialog content.

2. **Event propagation:** The ScenarioTable uses `onClick` on table rows for navigation. Checkboxes and action menu buttons call `e.stopPropagation()` to prevent row click handlers from firing.

3. **Menu portalling:** The row action Menu.Content uses `portalled={false}`, meaning menu items are rendered inside the table DOM rather than portalled to document body.

4. **TanStack React Table row IDs:** Row selection state uses scenario IDs (from `getRowId: (row) => row.id`), not numeric indices.

5. **Mutation invalidation:** After successful archive, the `scenarios.getAll` query is invalidated, causing the table to re-render without the archived scenarios. The `deselectAll()` function is also called to clear selection state.

6. **Unique naming:** Use timestamp suffixes or unique prefixes for scenario names across test suites to prevent cross-test interference since tests may not run in isolation.
