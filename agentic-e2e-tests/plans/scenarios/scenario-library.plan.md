# Test Plan: Scenario Library

**Feature specification:** `specs/scenarios/scenario-library.feature`

## Overview

The Scenario Library feature allows LangWatch users to browse, manage, and organize their behavioral test scenarios. This test plan covers:
- Navigation to the scenarios list page
- Viewing scenarios with their metadata (names and labels)
- Clicking scenarios to access the editor
- Handling empty states when no scenarios exist
- Filtering scenarios by label

---

## Suite 1: Navigation

**Seed file:** `seed.spec.ts`

### Test: Navigate to scenarios list

**File:** `tests/scenarios/scenario-library/navigate-to-scenarios-list.spec.ts`

**Steps:**
1. Navigate to the LangWatch home page at '/'
2. Locate the 'Simulations' link in the sidebar navigation
3. Click on the 'Simulations' link
4. Wait for the page to load and URL to update

**Expected Results:**
- URL contains '/simulations' after navigation
- Scenarios list page is displayed
- A 'New Scenario' button is visible on the page

---

## Suite 2: List View

**Seed file:** `seed.spec.ts`

### Test: View scenarios in list

**File:** `tests/scenarios/scenario-library/view-scenarios-in-list.spec.ts`

**Steps:**
1. Seed scenarios via API: 'Refund Flow' with label ['support'], 'Billing Check' with labels ['billing', 'edge']
2. Navigate to '/' and click 'Simulations' link in sidebar
3. Wait for the scenarios list page to load

**Expected Results:**
- A table or list view is visible containing scenarios
- Scenario names 'Refund Flow' and 'Billing Check' are displayed
- Each scenario row shows associated labels as badges
- Label badges display correctly (e.g., 'support', 'billing', 'edge')

### Test: Click scenario row to edit

**File:** `tests/scenarios/scenario-library/click-scenario-row-to-edit.spec.ts`

**Steps:**
1. Seed a scenario named 'Refund Flow' via API
2. Navigate to '/' and click 'Simulations' link in sidebar
3. Wait for the scenarios list to load
4. Locate the row containing 'Refund Flow'
5. Click on the 'Refund Flow' scenario row

**Expected Results:**
- Page navigates to the scenario editor
- URL pattern matches '/simulations/[id]/edit' or '/scenarios/[id]'
- Scenario editor loads with 'Refund Flow' scenario data

### Test: Empty state when no scenarios

**File:** `tests/scenarios/scenario-library/empty-state-when-no-scenarios.spec.ts`

**Steps:**
1. Ensure no scenarios exist in the project (fresh state or cleanup)
2. Navigate to '/' and click 'Simulations' link in sidebar
3. Wait for the scenarios list page to load

**Expected Results:**
- Empty state message is displayed (e.g., 'No scenarios', 'Get started', 'Create your first')
- A call-to-action button is visible to create a new scenario
- CTA button has text like 'New Scenario' or 'Create'

---

## Suite 3: Filtering

**Seed file:** `seed.spec.ts`

### Test: Filter scenarios by label

**File:** `tests/scenarios/scenario-library/filter-scenarios-by-label.spec.ts`

**Steps:**
1. Seed scenarios with various labels via API:
   - 'Refund Flow' with labels ['support']
   - 'Billing Check' with labels ['billing', 'edge']
   - 'Support FAQ' with labels ['support', 'faq']
2. Navigate to '/' and click 'Simulations' link in sidebar
3. Wait for the scenarios list to load showing all scenarios
4. Locate the label filter dropdown/combobox
5. Click on the filter control to open options
6. Select the 'support' label option from the dropdown

**Expected Results:**
- Only scenarios with the 'support' label are displayed
- 'Refund Flow' scenario is visible (has 'support' label)
- 'Support FAQ' scenario is visible (has 'support' label)
- 'Billing Check' scenario is NOT visible (does not have 'support' label)
- All visible scenario rows contain the 'support' label badge

---

## Implementation Notes

1. **Navigation:** Use `page.getByRole("link", { name: "Simulations", exact: true })` to find the sidebar link
2. **List View:** Expect a table with `page.getByRole("table")` and scenario rows with `page.getByRole("row")`
3. **Labels:** Use `data-testid="scenario-labels"` to identify label badges
4. **Filter:** Use `page.getByRole("combobox", { name: /label|filter/i })` for the filter control
5. **Editor Navigation:** Expect URL pattern `/simulations/[id]/edit` or `/scenarios/[id]`

## Test Data Requirements

Tests require API seeding capabilities for:
- Creating scenarios with specific names
- Assigning labels to scenarios
- Cleaning up scenarios for empty state testing
