import { test } from "../test.ts";
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
 * Test Plan: dev/tests/agentic-e2e/plans/http-agent-evaluations.plan.md
 */
test.describe("Full Evaluation Run with HTTP Agent Target", () => {
  // fixme: blocked on missing testids — spreadsheet-cell, cell-play-button, save-agent-button
  // are not yet present in the app source. Re-enable when testids are added to the evaluations
  // workbench spreadsheet component. Tracked in #1811.
  test.fixme();
  /**
   * Scenario: Full evaluation run with HTTP agent target
   * (http-agent-support.feature lines 222-231, Suite 1 Test 1).
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
    await thenTargetCellsShowOutput(page, "Echo API Agent", ["hello", "world", "test123"]);

    // And all evaluator chips show pass (green checkmark)
    await thenEvaluatorCellsShowPass(page, "exact_match", 3);

    // And target header shows aggregate pass rate
    await thenTargetHeaderShowsPassRate(page, /100%|3\/3/);
  });
});
