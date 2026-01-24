# Test Plan: Scenario Execution

**Feature specification:** `specs/scenarios/scenario-execution.feature`

## Overview

The Scenario Execution feature allows LangWatch users to run behavioral test scenarios against their agents (prompts or HTTP agents), view real-time conversation progress, and review completed results including pass/fail criteria and reasoning. This test plan covers:

- Running scenarios with prompt targets
- Running scenarios with HTTP agent targets
- Viewing conversations in real-time during execution
- Viewing completed run results with criteria verdicts
- Navigation between results and scenarios list
- Accessing run history for a scenario

---

## Suite 1: Running Scenarios

**Seed file:** `seed.spec.ts`

### Test: Run scenario with prompt target

**File:** `tests/scenarios/scenario-execution/run-scenario-with-prompt-target.spec.ts`

**Steps:**
1. Seed a scenario named "Refund Flow" with criteria via API
2. Seed a published prompt "Support Agent" via API
3. Navigate to the simulations page via sidebar
4. Click on a scenario set card to view runs
5. Click on an individual scenario run to view details
6. Click the "Run Again" button
7. In the Run Scenario modal, select "Support Agent" prompt from the target selector
8. Click the "Run" button in the modal

**Expected Results:**
- The Run Scenario modal displays with target selection options
- Prompts section shows available prompts including "Support Agent"
- After clicking Run, the modal closes
- The page navigates to the new run visualization
- A loading/in-progress state is displayed

### Test: Run scenario with HTTP agent target

**File:** `tests/scenarios/scenario-execution/run-scenario-with-http-agent-target.spec.ts`

**Steps:**
1. Seed a scenario named "Refund Flow" with criteria via API
2. Seed an HTTP agent "Production API" via API
3. Navigate to the simulations page via sidebar
4. Click on a scenario set card to view runs
5. Click on an individual scenario run to view details
6. Click the "Run Again" button
7. In the Run Scenario modal, select "Production API" from the HTTP Agents section
8. Click the "Run" button in the modal

**Expected Results:**
- The Run Scenario modal displays HTTP Agents section
- "Production API" appears in the HTTP Agents list
- After clicking Run, the scenario execution starts
- The conversation begins to appear in the chat area

---

## Suite 2: Viewing Results in Real-Time

**Seed file:** `seed.spec.ts`

### Test: View conversation in real-time

**File:** `tests/scenarios/scenario-execution/view-conversation-in-real-time.spec.ts`

**Steps:**
1. Seed a scenario and trigger a run via API (or use existing in-progress run)
2. Navigate to the scenario run visualization page
3. Observe the conversation area while the run is in progress
4. Wait for new messages to appear

**Expected Results:**
- The run visualization page loads showing the scenario name in header
- A status indicator shows "IN_PROGRESS" or similar running state
- The conversation area displays messages between simulator and target
- User messages appear right-aligned
- Assistant messages appear left-aligned with markdown rendering
- New messages appear dynamically without page refresh (1 second polling)
- Tool calls and results are displayed when applicable

---

## Suite 3: Viewing Completed Run Results

**Seed file:** `seed.spec.ts`

### Test: View completed run results with pass/fail criteria

**File:** `tests/scenarios/scenario-execution/view-completed-run-results.spec.ts`

**Steps:**
1. Seed a completed scenario run with mixed criteria results via API
2. Navigate to the scenario run visualization page
3. Scroll down to view the simulation console area

**Expected Results:**
- The scenario run header shows SUCCESS or FAILED status with appropriate icon
- The simulation console displays in a dark terminal-like interface
- Met criteria are listed with green checkmarks and count (e.g., "Met Criteria (2):")
- Unmet criteria are listed with red X marks and count (e.g., "Unmet Criteria (1):")
- Each criterion text is displayed under its category
- The overall verdict (success/failure/inconclusive) is clearly shown
- Duration is displayed (e.g., "Duration: 15s")
- Accuracy percentage is calculated and shown

### Test: View reasoning for criteria judgments

**File:** `tests/scenarios/scenario-execution/view-criteria-reasoning.spec.ts`

**Steps:**
1. Seed a completed scenario run with reasoning data via API
2. Navigate to the scenario run visualization page
3. Locate the simulation console section

**Expected Results:**
- A "Reasoning:" section is visible in the console
- The reasoning text explains why criteria were met or unmet
- Reasoning text is styled distinctly (bold, colored based on verdict)
- The reasoning provides actionable insight into the judgment

### Test: View full conversation history

**File:** `tests/scenarios/scenario-execution/view-full-conversation-history.spec.ts`

**Steps:**
1. Seed a completed scenario run with multiple conversation turns via API
2. Navigate to the scenario run visualization page
3. Observe the conversation area

**Expected Results:**
- All messages from the conversation are displayed
- Messages are ordered chronologically
- User (simulator) messages are visually distinct from assistant (target) messages
- The conversation is scrollable if it exceeds viewport
- Tool calls show the action name and arguments
- Tool results display the returned data

---

## Suite 4: Navigation

**Seed file:** `seed.spec.ts`

### Test: Navigate back to scenarios after viewing results

**File:** `tests/scenarios/scenario-execution/navigate-back-to-scenarios.spec.ts`

**Steps:**
1. Navigate to an individual scenario run visualization page
2. Click the "View All" button (with ArrowLeft icon)

**Expected Results:**
- The "View All" button is visible in the header area
- Clicking it navigates to the batch run grid view
- URL changes to match the batch run pattern (e.g., `/simulations/[setId]/[batchId]`)
- The grid view shows all scenario runs in the batch

### Test: Navigate from batch run grid to individual run

**File:** `tests/scenarios/scenario-execution/navigate-from-grid-to-run.spec.ts`

**Steps:**
1. Navigate to a batch run grid view page
2. Click on one of the scenario run cards in the grid

**Expected Results:**
- Scenario run cards are displayed in a responsive grid layout
- Clicking a card navigates to the individual run page
- URL includes the scenarioRunId

---

## Suite 5: Run History

**Seed file:** `seed.spec.ts`

### Test: View run history for a scenario

**File:** `tests/scenarios/scenario-execution/view-run-history.spec.ts`

**Steps:**
1. Seed a scenario that has been run multiple times via API
2. Navigate to an individual scenario run visualization page
3. Click the "Previous Runs" button

**Expected Results:**
- The "Previous Runs" button is visible in the header
- Clicking it opens a sidebar panel on the right
- The sidebar displays "Previous Runs" heading
- A list of past runs is shown with:
  - Status badge (completed/failed/running/cancelled)
  - Status icon matching the status
  - Duration in seconds
  - Accuracy percentage
  - Timestamp (date and time)
- Runs are sorted by timestamp (most recent first)

### Test: Click run in history to view details

**File:** `tests/scenarios/scenario-execution/click-history-run-to-view.spec.ts`

**Steps:**
1. Navigate to a scenario run page with previous runs available
2. Open the "Previous Runs" sidebar
3. Click on a different run in the history list

**Expected Results:**
- Each run item in the list is clickable (cursor: pointer)
- Clicking a run navigates to that run's visualization page
- The URL updates to include the selected scenarioRunId
- The conversation and console update to show the selected run's data

### Test: Empty state when no previous runs

**File:** `tests/scenarios/scenario-execution/empty-run-history.spec.ts`

**Steps:**
1. Navigate to a scenario run page for a scenario with only one run
2. Open the "Previous Runs" sidebar

**Expected Results:**
- An empty state is displayed with appropriate icon
- Message says "No previous runs found"
- Description explains "There are no simulations for this scenario yet"

---

## Suite 6: Error Handling

**Seed file:** `seed.spec.ts`

### Test: View error details for failed run

**File:** `tests/scenarios/scenario-execution/view-error-details.spec.ts`

**Steps:**
1. Seed a scenario run that ended in ERROR status via API
2. Navigate to the scenario run visualization page

**Expected Results:**
- The status shows ERROR with appropriate styling
- Error details are displayed in the simulation console
- The error message provides useful debugging information
- Criteria sections are not shown when there's an error

---

## Implementation Notes

1. **Navigation:** Use `page.getByRole("link", { name: "Simulations", exact: true })` to find the sidebar link
2. **Run Button:** Use `page.getByRole("button", { name: /run again/i })` for re-running scenarios
3. **Target Selection:** The target selector shows HTTP Agents first, then Prompts
4. **Status Icons:** ScenarioRunStatusIcon component shows different icons for SUCCESS/FAILED/ERROR/IN_PROGRESS/PENDING/CANCELLED
5. **Console:** The simulation console uses monospace font with dark background
6. **Polling:** Data refreshes every 1 second (refetchInterval: 1000)
7. **Previous Runs:** Toggle sidebar with "Previous Runs" button

## Test Data Requirements

Tests require API seeding capabilities for:
- Creating scenarios with specific names and criteria
- Creating HTTP agents with configured endpoints
- Creating published prompts
- Triggering scenario runs with specific targets
- Creating completed runs with specific verdicts and criteria results
- Creating runs with reasoning data
- Creating error state runs

## URL Patterns

- Simulations list: `/[project]/simulations`
- Scenario set (batch runs): `/[project]/simulations/[scenarioSetId]`
- Batch run grid: `/[project]/simulations/[scenarioSetId]/[batchRunId]`
- Individual run: `/[project]/simulations/[scenarioSetId]/[batchRunId]/[scenarioRunId]`
