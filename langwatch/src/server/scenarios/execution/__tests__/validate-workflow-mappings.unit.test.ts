/**
 * @vitest-environment node
 *
 * Unit tests for validateWorkflowAgentMappings.
 *
 * Covers the four cases: multi-input without mappings (error), single-input
 * without mappings (passes), multi-input with mappings (passes), and zero
 * inputs without mappings (passes).
 */

import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { validateWorkflowAgentMappings } from "../validate-workflow-mappings";

describe("validateWorkflowAgentMappings", () => {
  describe("when the workflow has multiple inputs and no mappings are configured", () => {
    it("throws a BAD_REQUEST TRPCError with an actionable message", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        })
      ).toThrow(TRPCError);
    });

    it("includes the agent id in the error message", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        })
      ).toThrow("agent-abc");
    });

    it("includes the input count in the error message", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        })
      ).toThrow("2 inputs");
    });

    it("directs the user to the agent editor", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        })
      ).toThrow("agent editor");
    });

    it("sets the TRPCError code to BAD_REQUEST", () => {
      let thrown: unknown;
      try {
        validateWorkflowAgentMappings({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TRPCError);
      expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
    });

    it("also throws when scenarioMappings is an empty object", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-xyz",
          inputs: [
            { identifier: "q", type: "str" },
            { identifier: "ctx", type: "str" },
          ],
          scenarioMappings: {},
        })
      ).toThrow(TRPCError);
    });
  });

  describe("when the workflow has exactly one input and no mappings are configured", () => {
    it("does not throw (legacy single-input fallback handles it)", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-single",
          inputs: [{ identifier: "input", type: "str" }],
          scenarioMappings: undefined,
        })
      ).not.toThrow();
    });
  });

  describe("when the workflow has multiple inputs and mappings are configured", () => {
    it("does not throw", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-mapped",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: {
            query: { type: "source", sourceId: "scenario", path: ["input"] },
            context: { type: "value", value: "static context" },
          },
        })
      ).not.toThrow();
    });
  });

  describe("when the workflow has zero inputs and no mappings are configured", () => {
    it("does not throw (edge case — adapter synthesises a default input)", () => {
      expect(() =>
        validateWorkflowAgentMappings({
          agentId: "agent-empty",
          inputs: [],
          scenarioMappings: undefined,
        })
      ).not.toThrow();
    });
  });
});
