import { describe, expect, it } from "vitest";
import type { TargetConfig } from "../../types";
import {
  applyForkedAgentToTarget,
  planDuplicateTarget,
} from "../duplicateTarget";

// `planDuplicateTarget` + `applyForkedAgentToTarget` are the pure halves of
// `handleDuplicateTarget` (in `components/EvaluationsV3Table.tsx`). The full
// handler also runs tRPC mutations (agents.copy + workflows.publish); those
// are exercised by integration tests in `src/experiments-v3/__tests__/`. The
// unit tests here cover the forking decision and the ID-plugging logic,
// which are what make the three BDD scenarios from #5879 hold:
//   1. code/HTTP agent target → fork-agent (edits to one don't leak to other)
//   2. workflow agent target → fork-agent with workflowId+workflowVersionId
//      surfaced so the caller can publish the forked workflow
//   3. prompt target → shallow (already correct; carries its own per-column
//      draft)
describe("planDuplicateTarget, given an agent target", () => {
  describe("when the agent is a code-type agent with a dbAgentId", () => {
    it("plans a fork-agent so the duplicate gets its own agent row (#5879 scenario 1)", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "agent",
        agentType: "code",
        dbAgentId: "agent_source_code",
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({
        kind: "fork-agent",
        sourceAgentId: "agent_source_code",
      });
    });
  });

  describe("when the agent is an HTTP agent with a dbAgentId", () => {
    it("plans a fork-agent (#5879 scenario 1)", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "agent",
        agentType: "http",
        dbAgentId: "agent_source_http",
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({
        kind: "fork-agent",
        sourceAgentId: "agent_source_http",
      });
    });
  });

  describe("when the agent is a workflow-type agent with a dbAgentId", () => {
    it("plans a fork-agent so both the agent and its workflow get forked (#5879 scenario 2)", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "agent",
        agentType: "workflow",
        dbAgentId: "agent_source_workflow",
        workflowId: "wf_source",
        workflowVersionId: "wv_source",
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({
        kind: "fork-agent",
        sourceAgentId: "agent_source_workflow",
      });
    });
  });

  describe("when the agent target is missing a dbAgentId (defensive)", () => {
    it("falls back to a shallow plan rather than fork nothing", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "agent",
        agentType: "code",
        // dbAgentId intentionally unset
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({ kind: "shallow" });
    });
  });
});

describe("planDuplicateTarget, given a non-agent target", () => {
  describe("when the target is a prompt (already carries its own per-column draft)", () => {
    it("plans a shallow spread (#5879 scenario 3 — prompt unaffected)", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "prompt",
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({ kind: "shallow" });
    });
  });

  describe("when the target is an evaluator", () => {
    it("plans a shallow spread", () => {
      const target: TargetConfig = {
        id: "target-original",
        type: "evaluator",
        targetEvaluatorId: "eval-1",
        inputs: [],
        outputs: [],
        mappings: {},
      };

      expect(planDuplicateTarget(target)).toEqual({ kind: "shallow" });
    });
  });
});

describe("applyForkedAgentToTarget", () => {
  const baseTarget: TargetConfig = {
    id: "target-original",
    type: "agent",
    agentType: "workflow",
    dbAgentId: "agent_source",
    workflowId: "wf_source",
    workflowVersionId: "wv_source",
    inputs: [],
    outputs: [],
    mappings: {},
  };

  describe("given a workflow-type agent fork result (with workflowId + workflowVersionId)", () => {
    it("plugs the forked agent id and the forked workflow ids into the new target (#5879 scenario 2)", () => {
      const result = applyForkedAgentToTarget(
        baseTarget,
        {
          id: "agent_forked",
          workflowId: "wf_forked",
          workflowVersionId: "wv_forked",
        },
        "target-new",
      );

      expect(result).toMatchObject({
        id: "target-new",
        dbAgentId: "agent_forked",
        workflowId: "wf_forked",
        workflowVersionId: "wv_forked",
      });
    });

    it("does not keep the source's dbAgentId, workflowId or workflowVersionId", () => {
      const result = applyForkedAgentToTarget(
        baseTarget,
        {
          id: "agent_forked",
          workflowId: "wf_forked",
          workflowVersionId: "wv_forked",
        },
        "target-new",
      );

      expect(result.dbAgentId).not.toBe("agent_source");
      expect(result.workflowId).not.toBe("wf_source");
      expect(result.workflowVersionId).not.toBe("wv_source");
    });
  });

  describe("given a non-workflow agent fork result (no workflow fields)", () => {
    it("plugs the forked agent id and clears stale workflow fields (#5879 scenario 1)", () => {
      // baseTarget here is a code-type agent (no workflow fields to leak)
      const codeBaseTarget: TargetConfig = {
        ...baseTarget,
        agentType: "code",
        workflowId: undefined,
        workflowVersionId: undefined,
      };

      const result = applyForkedAgentToTarget(
        codeBaseTarget,
        { id: "agent_forked" },
        "target-new",
      );

      expect(result).toMatchObject({
        id: "target-new",
        dbAgentId: "agent_forked",
        workflowId: undefined,
        workflowVersionId: undefined,
      });
    });

    // Regression: if a workflow-type agent's forked result somehow lacks
    // workflow ids (backend bug, partial failure), the new target must NOT
    // silently keep pointing at the source's workflow — that's the original
    // bug from #5879. Unconditional assignment (not conditional spread) is
    // what guarantees this.
    it("clears stale workflow fields on the base target when the fork has none", () => {
      const result = applyForkedAgentToTarget(
        baseTarget, // has wf_source / wv_source
        { id: "agent_forked" }, // no workflow fields
        "target-new",
      );

      expect(result.workflowId).toBeUndefined();
      expect(result.workflowVersionId).toBeUndefined();
      expect(result.dbAgentId).toBe("agent_forked");
    });
  });
});
