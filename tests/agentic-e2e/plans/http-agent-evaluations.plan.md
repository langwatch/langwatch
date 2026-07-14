# Test Plan: HTTP Agent Support in Evaluations V3

**Feature specification:** `specs/evaluations-v3/http-agent-support.feature`

## Overview

This test plan covers HTTP Agent support in the Evaluations V3 Workbench. HTTP agents allow users to evaluate external AI agents exposed via HTTP endpoints.

**Base URL for E2E tests:** `http://localhost:5570`

---

## Suite 1: Full Evaluation Run with HTTP Agent Target

Covers feature scenario lines 222-231:
```gherkin
@e2e
Scenario: Full evaluation run with HTTP agent target
  Given I have an HTTP agent target pointing to a mock endpoint
  And the mock endpoint echoes the input
  And I have a dataset with 3 rows
  And I have an exact_match evaluator
  When I click "Evaluate"
  Then the HTTP agent executes for all 3 rows
  And evaluator results appear in the spreadsheet
  And aggregate pass rate is shown in the target header
```

### Test 1: Complete HTTP agent evaluation workflow

**File:** `tests/evaluations-v3/http-agent-full-evaluation.spec.ts`

**Steps:**
1. Navigate to Evaluations page at `/{project}/evaluations`
2. Click "New Evaluation" dropdown > "Experiment"
3. Wait for redirect to `/experiments/workbench/{slug}`
4. Click "Add" button in "Prompts or Agents" header
5. Select "Agent" from TargetTypeSelectorDrawer
6. Click "New Agent" in AgentListDrawer
7. Select "HTTP Agent" in AgentTypeSelectorDrawer
8. Configure HTTP agent:
   - Name: "Echo API Agent"
   - Method: POST
   - URL: `https://httpbin.org/post`
   - Body template: `{"data": "{{input}}"}`
   - Output path: `$.json.data`
9. Click "Create Agent"
10. Add dataset rows:
    - Row 0: input="hello", expected_output="hello"
    - Row 1: input="world", expected_output="world"
    - Row 2: input="test123", expected_output="test123"
11. Add exact_match evaluator mapped to target.output vs dataset.expected_output
12. Click "Evaluate"
13. Wait for execution to complete

**Expected Results:**
- All 3 target cells show echoed output
- All 3 evaluator chips show pass (green checkmark)
- Target header shows aggregate "100%" or "3/3 passed"

---

## Suite 2: Single Cell Re-execution

Covers feature scenario lines 233-238:
```gherkin
@e2e
Scenario: Single cell re-execution for HTTP agent
  Given I have HTTP agent results from a previous run
  When I click the play button on a specific cell
  Then only that cell's HTTP request is re-executed
  And the evaluators re-run for that cell
```

### Test 2: Re-execute single cell via play button

**File:** `tests/evaluations-v3/http-agent-cell-rerun.spec.ts`

**Prerequisites:** Evaluation results exist from Test 1

**Steps:**
1. Modify row 1 input from "world" to "modified"
2. Hover over target cell in row 1
3. Click the play button on the cell
4. Wait for loading to complete

**Expected Results:**
- Only row 1 shows loading skeleton during execution
- Rows 0 and 2 remain unchanged
- Row 1 target cell now shows "modified"
- Row 1 evaluator fails (output "modified" != expected "world")
- Aggregate stats update to 2/3 pass rate

---

## Navigation Paths

- Evaluations page: `/{project}/evaluations`
- New experiment: Click "New Evaluation" dropdown > "Experiment"
- Workbench: `/{project}/experiments/workbench/{slug}`

## Key Selectors

- `data-testid="target-type-agent"` - Agent card in target type selector
- `data-testid="new-agent-button"` - New Agent button
- `data-testid="agent-type-http"` - HTTP Agent type card
- `data-testid="agent-name-input"` - Name input field
- `data-testid="url-input"` - URL input field
- `data-testid="save-agent-button"` - Save/Create button
- Globe icon indicates HTTP agent type in lists

## Mock Endpoint

Use `https://httpbin.org/post` which:
- Accepts POST requests
- Echoes request body in `.json` field
- Publicly available, no auth required

## Chakra UI Notes

Use `.last()` to target visible dialog elements:
```typescript
await page.getByRole("button", { name: "Create Agent" }).last().click();
```
