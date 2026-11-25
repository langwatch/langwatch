/**
 * What a run's key may carry: only what the run uses.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { describe, expect, it } from "vitest";

import { runKeyPermissions } from "../workflow-run-permissions.ts";

const signature = { id: "llm", type: "signature", data: { parameters: [] } };
const evaluator = { id: "eval", type: "evaluator", data: {} };
const custom = { id: "custom", type: "custom", data: {} };
const workflowAgent = {
  id: "agent",
  type: "agent",
  data: { parameters: [{ identifier: "agent_type", value: "workflow" }] },
};
const httpAgent = {
  id: "http",
  type: "agent",
  data: { parameters: [{ identifier: "agent_type", value: "http" }] },
};

describe("runKeyPermissions", () => {
  it("gives a graph with no evaluator or workflow node traces only", () => {
    expect(runKeyPermissions({ eventType: "execute_flow", nodes: [signature, httpAgent] })).toEqual(
      ["traces:create"],
    );
  });

  /** @scenario "A run's key carries only the permissions the run uses" */
  it("never carries evaluations or workflows for an evaluator-free, workflow-free graph", () => {
    const permissions = runKeyPermissions({ eventType: "execute_flow", nodes: [signature] });

    expect(permissions).not.toContain("evaluations:manage");
    expect(permissions).not.toContain("workflows:manage");
  });

  /** @scenario "A run's key carries only the permissions the run uses" */
  it("adds evaluations for an evaluator node and not workflows", () => {
    expect(runKeyPermissions({ eventType: "execute_flow", nodes: [signature, evaluator] })).toEqual(
      ["traces:create", "evaluations:manage"],
    );
  });

  it("adds workflows for a custom node and for an agent that runs a workflow", () => {
    expect(runKeyPermissions({ eventType: "execute_flow", nodes: [custom] })).toEqual([
      "traces:create",
      "workflows:manage",
    ]);
    expect(runKeyPermissions({ eventType: "execute_flow", nodes: [workflowAgent] })).toEqual([
      "traces:create",
      "workflows:manage",
    ]);
  });

  it("adds evaluations when the run logs batch results, whatever its graph", () => {
    expect(runKeyPermissions({ eventType: "execute_evaluation", nodes: [signature] })).toEqual([
      "traces:create",
      "evaluations:manage",
    ]);
  });

  it("lists every permission once, in one order, for a graph that needs all three", () => {
    expect(
      runKeyPermissions({ eventType: "execute_flow", nodes: [custom, evaluator, evaluator] }),
    ).toEqual(["traces:create", "evaluations:manage", "workflows:manage"]);
  });

  it("reaches only its own node when one component runs", () => {
    expect(
      runKeyPermissions({
        eventType: "execute_component",
        nodeId: "llm",
        nodes: [signature, evaluator, custom],
      }),
    ).toEqual(["traces:create"]);
    expect(
      runKeyPermissions({
        eventType: "execute_component",
        nodeId: "eval",
        nodes: [signature, evaluator, custom],
      }),
    ).toEqual(["traces:create", "evaluations:manage"]);
  });

  it("ignores a node it cannot read", () => {
    expect(runKeyPermissions({ eventType: "execute_flow", nodes: [null, 3, "x"] })).toEqual([
      "traces:create",
    ]);
  });
});
