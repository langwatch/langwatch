---
name: e2e
description: "Generate and verify E2E tests for a feature. Explores live app, creates test plan, generates tests, runs and fixes until passing."
user-invocable: true
argument-hint: "[feature-file-path or scenario description]"
---

# E2E Test Generation Workflow

You coordinate E2E test creation and verification. You invoke specialized agents in sequence and verify the outcome.

## Prerequisites

Before running this workflow:
1. The app must be running locally (`make dev` or equivalent)
2. E2E infrastructure must be up (`cd agentic-e2e-tests && docker compose up -d`)
3. The feature should already be implemented and reviewed

## Input

You receive either:
- A feature file path (e.g., `specs/scenarios/scenario-editor.feature`)
- A scenario description to verify

Extract the `@e2e` tagged scenarios from the feature file if provided.

## Workflow

### 1. Explore and Plan

Invoke the `playwright-test-planner` agent via Task tool:

```
Task(subagent_type: "playwright-test-planner", prompt: """
Explore the live app at http://localhost:5570 and create a test plan for:

<scenarios>
[List the @e2e scenarios from the feature file]
</scenarios>

Focus on:
- Discovering the actual UI elements and navigation
- Creating step-by-step test plans that match the scenarios
- Documenting expected outcomes

Save the plan to: agentic-e2e-tests/plans/[feature-name].plan.md
""")
```

**Verify:** Plan file exists and covers all scenarios.

### 2. Generate Tests

Invoke the `playwright-test-generator` agent via Task tool:

```
Task(subagent_type: "playwright-test-generator", prompt: """
Generate Playwright tests from the test plan:

<plan-file>agentic-e2e-tests/plans/[feature-name].plan.md</plan-file>

For each scenario in the plan:
1. Set up the page using generator_setup_page
2. Execute each step in the browser
3. Generate the test code from the execution log
4. Save to: agentic-e2e-tests/tests/[feature-name]/[scenario-name].spec.ts

Follow the project conventions in agentic-e2e-tests/README.md:
- Use step functions from steps.ts (Given/When/Then naming)
- Handle Chakra UI duplicates with .last()
- No "should" in test names
""")
```

**Verify:** Test files exist for each scenario.

### 3. Run and Heal

Invoke the `playwright-test-healer` agent via Task tool:

```
Task(subagent_type: "playwright-test-healer", prompt: """
Run and fix the generated E2E tests:

1. Run all tests in agentic-e2e-tests/tests/[feature-name]/
2. For any failures, diagnose the root cause:

   **Test Issue** (healer fixes):
   - Wrong selector (element changed)
   - Timing issue (race condition)
   - Incorrect assertion syntax
   - Missing wait or setup step

   **App Bug** (needs code fix):
   - Feature doesn't work as specified
   - Expected element/behavior missing
   - Error thrown during user flow
   - Data not saved/displayed correctly

3. For test issues: fix and re-run
4. For app bugs: mark as test.fixme() with detailed explanation:
   - What the spec expects
   - What the app actually does
   - Why this is an app bug, not a test issue

Continue until all tests pass or are marked fixme with clear rationale.
""")
```

**Verify:**
- All tests pass → continue to review
- Tests marked fixme → examine rationale to determine if app bug or inconclusive

### 4. Review Tests (Optional)

If tests required significant healing, invoke `test-reviewer`:

```
Task(subagent_type: "test-reviewer", prompt: """
Review the E2E tests in agentic-e2e-tests/tests/[feature-name]/

Focus on:
- Naming conventions (no "should")
- Proper pyramid placement (these should be E2E, not integration)
- Step function quality
- Locator robustness
""")
```

## Output

Return a summary to the orchestrator with clear status:

### If All Tests Pass
```
## E2E Verification Complete ✓

**Feature:** [feature name]
**Scenarios Tested:** [count]
**Status:** ALL PASSING

### Tests Generated
- [test-file-1.spec.ts] - passing
- [test-file-2.spec.ts] - passing

### Coverage
- [scenario 1] ✓ covered
- [scenario 2] ✓ covered
```

### If Tests Fail Due to App Bugs
```
## E2E Verification Failed - App Bug Detected

**Feature:** [feature name]
**Status:** NEEDS CODE FIX

### Failing Scenarios
- **Scenario:** [scenario name]
  **Expected:** [what the spec says should happen]
  **Actual:** [what the app actually does]
  **Evidence:** [screenshot path or error details]

### Recommendation
The implementation does not match the spec. Send back to /code with:
- Scenario: [scenario name]
- Expected behavior: [from spec]
- Actual behavior: [observed]
- Fix needed: [specific change required]
```

### If Tests Marked as Fixme (Inconclusive)
```
## E2E Verification Partial

**Feature:** [feature name]
**Status:** NEEDS REVIEW

### Tests with Issues
- [test-file.spec.ts] - marked fixme
  **Reason:** [why it couldn't be determined if app or test is wrong]

### Recommendation
Manual review needed to determine if this is an app bug or test issue.
```

## Boundaries

You coordinate, you don't write tests directly:
- `playwright-test-planner` explores and plans
- `playwright-test-generator` generates tests
- `playwright-test-healer` fixes failures
- `test-reviewer` checks quality

You verify outcomes and report status.
