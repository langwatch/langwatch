# Test Plan: Scenario Editor

**Feature specification:** `specs/scenarios/scenario-editor.feature`

## Overview

This test plan covers the LangWatch Scenario Editor feature, which allows users to create and edit behavioral test case specifications (scenarios) for their AI agents. The editor follows a 3-Part Spec model consisting of: Situation (what context to test), Script (the test steps/criteria), and Score (expected outcomes).

The Scenario Editor is accessed via the Simulations page and provides a form-based interface for defining:
- Scenario name and metadata
- Situation description (the context for testing)
- Success criteria (list of behaviors to verify)
- Labels for organization
- Target configuration (which agent/prompt to test)

---

## Suite 1: Create Scenario

**Seed file:** `seed.spec.ts`

### Test: Navigate to create form

**File:** `tests/scenarios/scenario-editor/navigate-to-create-form.spec.ts`

**Steps:**
1. Navigate to the Simulations page via the sidebar link
2. Click the "New Scenario" button
3. Wait for the page to load

**Expected Results:**
- URL changes to match pattern `/simulations/new` or `/scenarios/create`
- An empty scenario form is displayed
- The Name field is visible and empty
- The form is ready for input

### Test: View scenario form fields

**File:** `tests/scenarios/scenario-editor/view-form-fields.spec.ts`

**Steps:**
1. Navigate to the Simulations page
2. Click "New Scenario" to open the editor
3. Inspect the form for required fields

**Expected Results:**
- Name field is visible as a text input with label "Name"
- Situation field is visible as a textarea with label "Situation"
- Criteria section is visible with heading "Criteria"
- An "Add Criterion" button is visible for the criteria list
- Labels field is visible as a tag/multi-select input with label "Labels"
- A target selector section is visible for configuring the test target

### Test: Save new scenario

**File:** `tests/scenarios/scenario-editor/save-new-scenario.spec.ts`

**Steps:**
1. Navigate to the Simulations page
2. Click "New Scenario" to open the editor
3. Fill in "Name" with "Refund Request Test"
4. Fill in "Situation" with "User requests a refund for a defective product"
5. Type "Agent acknowledges the issue" in the criterion input
6. Click "Add Criterion" button
7. Type "Agent offers a solution" in the criterion input
8. Click "Add Criterion" button
9. Click the "Save" button

**Expected Results:**
- User is redirected back to the scenarios list page
- URL no longer contains `/new` or `/create`
- "Refund Request Test" appears as a row in the scenarios list
- A success notification/toast may appear confirming the save

---

## Suite 2: Edit Scenario

**Seed file:** `seed.spec.ts`

**Prerequisites:** These tests require a pre-existing scenario named "Refund Flow" to be seeded via API before the test runs.

### Test: Load existing scenario for editing

**File:** `tests/scenarios/scenario-editor/load-existing-scenario.spec.ts`

**Steps:**
1. Seed a scenario named "Refund Flow" with situation "User wants a refund" and criteria ["Acknowledge", "Resolve"]
2. Navigate to the Simulations page
3. Click on the "Refund Flow" row in the list

**Expected Results:**
- The scenario editor form opens
- Name field is pre-populated with "Refund Flow"
- Situation field contains the stored situation text
- Criteria list displays the existing criteria items
- All form fields are editable

### Test: Update scenario name

**File:** `tests/scenarios/scenario-editor/update-scenario-name.spec.ts`

**Steps:**
1. Seed a scenario named "Refund Flow"
2. Navigate to the Simulations page
3. Click on "Refund Flow" to open the editor
4. Clear the Name field
5. Type "Refund Flow (Updated)" in the Name field
6. Click the "Save" button

**Expected Results:**
- User is redirected to the scenarios list
- The row that previously showed "Refund Flow" now shows "Refund Flow (Updated)"
- The original "Refund Flow" name no longer appears in the list

---

## Suite 3: Criteria Management

**Seed file:** `seed.spec.ts`

### Test: Add criterion to list

**File:** `tests/scenarios/scenario-editor/add-criterion.spec.ts`

**Steps:**
1. Navigate to the Simulations page
2. Click "New Scenario" to open the editor
3. Locate the criterion input field
4. Type "Agent must apologize" in the criterion input
5. Click the "Add Criterion" button

**Expected Results:**
- "Agent must apologize" appears in the criteria list (element with `data-testid="criteria-list"`)
- The criterion input field is cleared and ready for the next entry
- The add button remains visible for adding more criteria

### Test: Remove criterion from list

**File:** `tests/scenarios/scenario-editor/remove-criterion.spec.ts`

**Steps:**
1. Navigate to the Simulations page
2. Click "New Scenario" to open the editor
3. Add criterion "Criterion A" and click "Add Criterion"
4. Add criterion "Criterion B" and click "Add Criterion"
5. Verify both criteria appear in the list
6. Click the remove/delete button on "Criterion A"

**Expected Results:**
- "Criterion A" is removed from the criteria list
- "Criterion B" remains visible in the criteria list
- The criteria list now contains only one item

---

## Suite 4: Target Configuration

**Seed file:** `seed.spec.ts`

### Test: Configure prompt as target

**File:** `tests/scenarios/scenario-editor/configure-prompt-target.spec.ts`

**Prerequisites:** Project must have at least one prompt configured (seeded via API).

**Steps:**
1. Seed at least one prompt in the project
2. Navigate to the Simulations page
3. Click "New Scenario" to open the editor
4. Click the "Select Target" button/dropdown

**Expected Results:**
- A target selection dropdown/modal opens
- Available prompts from the project are listed as options
- Each prompt option shows the prompt name
- User can select a prompt as the test target

### Test: Configure HTTP agent as target

**File:** `tests/scenarios/scenario-editor/configure-http-target.spec.ts`

**Steps:**
1. Navigate to the Simulations page
2. Click "New Scenario" to open the editor
3. Click the "Select Target" button/dropdown
4. Select "HTTP Agent" from the target type options

**Expected Results:**
- HTTP Agent configuration fields appear
- URL/Endpoint input field is visible and editable
- HTTP Method selector is visible (GET, POST, etc.)
- User can configure the HTTP endpoint details for testing an external agent

---

## Edge Cases and Negative Tests

### Test: Attempt to save scenario with empty name

**Steps:**
1. Navigate to create scenario page
2. Leave the Name field empty
3. Fill in other required fields
4. Click Save

**Expected Results:**
- Form validation prevents submission
- Error message appears indicating name is required
- User remains on the editor page

### Test: Attempt to add empty criterion

**Steps:**
1. Navigate to create scenario page
2. Leave the criterion input empty
3. Click "Add Criterion" button

**Expected Results:**
- Empty criterion is not added to the list
- Validation message may appear
- Criteria list remains unchanged

---

## Implementation Notes

- **Navigation Path:** Sidebar "Simulations" link -> Simulations list page -> "New Scenario" button -> Editor
- **URL Patterns:** `/simulations`, `/simulations/new`, `/simulations/[id]/edit`
- **Key Test IDs:**
  - `data-testid="criteria-list"` - Container for criteria items
  - `data-testid="criterion-item"` - Individual criterion entry
- **Form Labels:**
  - Name field: label contains "name" (case-insensitive)
  - Situation field: label contains "situation" (case-insensitive)
  - Criterion input: label contains "criterion" (case-insensitive)
  - Labels field: label contains "labels" (case-insensitive)

## Test Data Requirements

| Data Item | Description | Setup Method |
|-----------|-------------|--------------|
| Existing Scenario | "Refund Flow" with situation and criteria | API seed before edit tests |
| Project Prompts | At least one prompt for target selection | API seed before target tests |
| User Authentication | Logged-in user with project access | Auth setup fixture |
