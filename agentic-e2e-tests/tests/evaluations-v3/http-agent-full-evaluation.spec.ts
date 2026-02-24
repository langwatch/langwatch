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
  thenTargetCellsShowOutput,
  thenEvaluatorCellsShowPass,
  thenTargetHeaderShowsPassRate,
} from "./steps";

/**
 * Feature: HTTP Agent Support in Evaluations V3
 * Source: specs/evaluations-v3/http-agent-support.feature
 * Test Plan: agentic-e2e-tests/plans/http-agent-evaluations.plan.md
 *
 * As a user evaluating AI agents
 * I want to use HTTP agents as targets in Evaluations V3
 * So that I can evaluate external APIs that expose my agent via HTTP endpoints
 */
test.describe("Full Evaluation Run with HTTP Agent Target", () => {
  // TODO(#1811): flaky on CI — URL navigation fails consistently
  test.fixme();
  /**
   * Scenario: Full evaluation run with HTTP agent target
   * Source: http-agent-support.feature lines 222-231
   * Test Plan: Suite 1, Test 1
   *
   * Given I have an HTTP agent target pointing to a mock endpoint
   * And the mock endpoint echoes the input
   * And I have a dataset with 3 rows
   * And I have an exact_match evaluator
   * When I click "Evaluate"
   * Then the HTTP agent executes for all 3 rows
   * And evaluator results appear in the spreadsheet
   * And aggregate pass rate is shown in the target header
   */
  test("complete HTTP agent evaluation workflow", async ({ page }) => {
    // Given I am on the evaluations page
    await givenIAmOnTheEvaluationsPage(page);

    // When I click "New Evaluation" dropdown and select "Experiment"
    await whenICreateNewExperiment(page);

    // And I click "Add" button in targets section
    await whenIClickAddTarget(page);

    // And I select "Agent" from target type selector
    await whenISelectAgentTargetType(page);

    // And I click "New Agent" button
    await whenIClickNewAgent(page);

    // And I select "HTTP Agent" type
    await whenISelectHTTPAgentType(page);

    // And I configure HTTP agent
    await whenIConfigureHTTPAgent(page, {
      name: "Echo API Agent",
      method: "POST",
      url: "https://httpbin.org/post",
      bodyTemplate: '{"data": "{{input}}"}',
      outputPath: "$.json.data",
    });

    // And I click "Create Agent"
    await whenIClickCreateAgent(page);

    // And I add dataset rows
    await whenIAddDatasetRow(page, 0, "hello", "hello");
    await whenIAddDatasetRow(page, 1, "world", "world");
    await whenIAddDatasetRow(page, 2, "test123", "test123");

    // And I add exact_match evaluator
    await whenIAddExactMatchEvaluator(page);

    // When I click "Evaluate"
    await whenIClickEvaluate(page);

    // And I wait for execution to complete
    await whenIWaitForEvaluationComplete(page, 3);

    // Then all target cells show echoed output
    await thenTargetCellsShowOutput(page, "Echo API Agent", [
      "hello",
      "world",
      "test123",
    ]);

    // And all evaluator chips show pass (green checkmark)
    await thenEvaluatorCellsShowPass(page, "exact_match", 3);

    // And target header shows aggregate pass rate
    await thenTargetHeaderShowsPassRate(page, /100%|3\/3/);
  });
});
