import { test } from "@playwright/test";
import {
  givenIAmOnTheEvaluationsPage,
  whenICreateNewExperiment,
  whenIClickAddTarget,
  whenISelectAgentTargetType,
  whenIClickNewAgent,
  whenISelectHTTPAgentType,
  whenIConfigureHTTPAgent,
  whenIClickCreateAgent,
  whenIAddDatasetRow,
  whenIAddExactMatchEvaluator,
  whenIClickEvaluate,
  whenIWaitForEvaluationComplete,
  whenIModifyDatasetRowInput,
  whenIClickPlayButtonOnCell,
  thenOnlyRowShowsLoading,
  thenOtherRowsRemainUnchanged,
  thenCellShowsOutput,
  thenEvaluatorShowsFailForRow,
  thenTargetHeaderShowsPassRate,
} from "./steps";

/**
 * Feature: HTTP Agent Support in Evaluations V3
 * Source: specs/evaluations-v3/http-agent-support.feature
 * Test Plan: agentic-e2e-tests/plans/http-agent-evaluations.plan.md
 *
 * As a user evaluating AI agents
 * I want to re-execute individual cells
 * So that I can test modifications without re-running the entire evaluation
 */
// Skipped: flaky — Lambda warmup failures in CI cause timeouts (#1802)
test.describe.skip("Single Cell Re-execution", () => {
  /**
   * Scenario: Single cell re-execution for HTTP agent
   * Source: http-agent-support.feature lines 233-238
   * Test Plan: Suite 2, Test 2
   *
   * Given I have HTTP agent results from a previous run
   * When I click the play button on a specific cell
   * Then only that cell's HTTP request is re-executed
   * And the evaluators re-run for that cell
   */
  test("re-execute single cell via play button", async ({ page }) => {
    // Setup: Create evaluation with HTTP agent (same as previous test)
    await givenIAmOnTheEvaluationsPage(page);
    await whenICreateNewExperiment(page);
    await whenIClickAddTarget(page);
    await whenISelectAgentTargetType(page);
    await whenIClickNewAgent(page);
    await whenISelectHTTPAgentType(page);
    await whenIConfigureHTTPAgent(page, {
      name: "Echo API Agent",
      method: "POST",
      url: "https://httpbin.org/post",
      bodyTemplate: '{"data": "{{input}}"}',
      outputPath: "$.json.data",
    });
    await whenIClickCreateAgent(page);

    // Add dataset rows
    await whenIAddDatasetRow(page, 0, "hello", "hello");
    await whenIAddDatasetRow(page, 1, "world", "world");
    await whenIAddDatasetRow(page, 2, "test123", "test123");

    // Add evaluator
    await whenIAddExactMatchEvaluator(page);

    // Run initial evaluation
    await whenIClickEvaluate(page);
    await whenIWaitForEvaluationComplete(page, 3);

    // Given I have HTTP agent results from a previous run
    // (Results now exist from the evaluation above)

    // When I modify row 1 input from "world" to "modified"
    await whenIModifyDatasetRowInput(page, 1, "modified");

    // And I hover over target cell in row 1
    // And I click the play button on the cell
    await whenIClickPlayButtonOnCell(page, 1, "Echo API Agent");

    // Then only row 1 shows loading skeleton during execution
    await thenOnlyRowShowsLoading(page, 1);

    // Wait for execution to complete
    await whenIWaitForEvaluationComplete(page, 1);

    // And rows 0 and 2 remain unchanged
    await thenOtherRowsRemainUnchanged(page, [0, 2], "Echo API Agent", [
      "hello",
      "test123",
    ]);

    // And row 1 target cell now shows "modified"
    await thenCellShowsOutput(page, 1, "Echo API Agent", "modified");

    // And row 1 evaluator fails (output "modified" != expected "world")
    await thenEvaluatorShowsFailForRow(page, 1, "exact_match");

    // And aggregate stats update to 2/3 pass rate
    await thenTargetHeaderShowsPassRate(page, /66%|2\/3/);
  });
});
