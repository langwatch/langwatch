/**
 * @vitest-environment node
 *
 * Schema validation tests for workflow target type acceptance.
 * Verifies that all schemas in the execution pipeline accept "workflow".
 *
 * Uses inline Zod schemas mirroring production definitions to avoid
 * transitively importing Prisma client (which requires generation).
 */

import { describe, expect, it } from "vitest";
import { TargetConfigSchema, WorkflowAgentDataSchema, TargetAdapterDataSchema } from "../types";

describe("workflow schema validation", () => {
  describe("TargetConfigSchema", () => {
    it("accepts workflow target type", () => {
      const target = { type: "workflow", referenceId: "agent_wf_123" };
      const result = TargetConfigSchema.safeParse(target);
      expect(result.success).toBe(true);
    });
  });

  describe("WorkflowAgentDataSchema", () => {
    it("accepts valid workflow agent data", () => {
      const data = {
        type: "workflow",
        agentId: "agent_wf_123",
        workflowDsl: { nodes: [], edges: [] },
        entryInputs: [{ identifier: "input", type: "str" }],
        endOutputs: [{ identifier: "output", type: "str" }],
      };
      const result = WorkflowAgentDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("TargetAdapterDataSchema", () => {
    it("accepts workflow adapter data in the discriminated union", () => {
      const data = {
        type: "workflow",
        agentId: "agent_wf_123",
        workflowDsl: { nodes: [], edges: [] },
        entryInputs: [{ identifier: "input", type: "str" }],
        endOutputs: [{ identifier: "output", type: "str" }],
      };
      const result = TargetAdapterDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});
