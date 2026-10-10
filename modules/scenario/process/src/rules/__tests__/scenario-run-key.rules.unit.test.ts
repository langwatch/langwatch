/**
 * What a scenario run's key may carry: only what its target needs.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { describe, expect, it } from "vitest";

import { scenarioRunKeyPermissions } from "../scenario-run-key.rules.ts";

describe("scenarioRunKeyPermissions", () => {
  /** @scenario "A run nobody started calls LangWatch with a project key holding only what it needs" */
  it("gives every non-workflow target what the child itself calls: run events and its traces", () => {
    for (const targetType of ["prompt", "code", "http", "voice", "connected"]) {
      expect(scenarioRunKeyPermissions({ targetType, workflowNodes: undefined })).toEqual([
        "traces:create",
        "traces:view",
        "scenarios:create",
      ]);
    }
  });

  it("follows the workflow graph for a workflow target", () => {
    const nodes = [{ id: "eval", type: "evaluator", data: {} }];

    expect(scenarioRunKeyPermissions({ targetType: "workflow", workflowNodes: nodes })).toEqual([
      "traces:create",
      "traces:view",
      "scenarios:create",
      "evaluations:manage",
    ]);
    expect(scenarioRunKeyPermissions({ targetType: "workflow", workflowNodes: [] })).toEqual([
      "traces:create",
      "traces:view",
      "scenarios:create",
    ]);
  });
});
