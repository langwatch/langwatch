/**
 * What a scenario run's key may carry: only what its target needs.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { describe, expect, it } from "vitest";

import { scenarioRunKeyPermissions } from "../scenario-run-key.rules.ts";

describe("scenarioRunKeyPermissions", () => {
  /** @scenario "A run nobody started calls LangWatch with a project key holding only what it needs" */
  it("gives a prompt, code, http or voice target traces alone", () => {
    for (const targetType of ["prompt", "code", "http", "voice"]) {
      expect(scenarioRunKeyPermissions({ targetType, workflowNodes: undefined })).toEqual([
        "traces:create",
      ]);
    }
  });

  it("adds the agent relay for a connected agent", () => {
    expect(
      scenarioRunKeyPermissions({ targetType: "connected", workflowNodes: undefined }),
    ).toEqual(["traces:create", "scenarios:create"]);
  });

  it("follows the workflow graph for a workflow target", () => {
    const nodes = [{ id: "eval", type: "evaluator", data: {} }];

    expect(scenarioRunKeyPermissions({ targetType: "workflow", workflowNodes: nodes })).toEqual([
      "traces:create",
      "evaluations:manage",
    ]);
    expect(scenarioRunKeyPermissions({ targetType: "workflow", workflowNodes: [] })).toEqual([
      "traces:create",
    ]);
  });
});
