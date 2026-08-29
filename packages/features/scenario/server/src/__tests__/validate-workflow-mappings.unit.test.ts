/**
 * @vitest-environment node
 *
 * Unit tests for validateWorkflowAgentMappings.
 *
 * Covers the four cases: multi-input without mappings (error), single-input
 * without mappings (passes), multi-input with mappings (passes), and zero
 * inputs without mappings (passes).
 */

import { describe, expect, it } from "vitest";
import { ScenarioWorkflowMappingService } from "../index";

const mappings = ScenarioWorkflowMappingService.create();

describe("validateWorkflowAgentMappings", () => {
  describe("when the workflow has multiple inputs and no mappings are configured", () => {
    /** @scenario Returns actionable error for multi-input workflow agent without mappings */
    it("throws a BAD_REQUEST TRPCError with an actionable message", () => {
      expect(() =>
        mappings.validate({
          agentId: "agent-abc",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: undefined,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message:
            "Workflow agent 'agent-abc' has 2 inputs but no scenario mappings configured. Open the agent editor to configure how scenario data maps to the workflow's inputs.",
        }),
      );
    });

    it("also throws when scenarioMappings is an empty object", () => {
      expect(() =>
        mappings.validate({
          agentId: "agent-xyz",
          inputs: [
            { identifier: "q", type: "str" },
            { identifier: "ctx", type: "str" },
          ],
          scenarioMappings: {},
        }),
      ).toThrowError(expect.objectContaining({ code: "BAD_REQUEST" }));
    });
  });

  describe("when the workflow has exactly one input and no mappings are configured", () => {
    /** @scenario Allows single-input workflow agent to run without explicit mappings */
    it("does not throw (legacy single-input fallback handles it)", () => {
      expect(() =>
        mappings.validate({
          agentId: "agent-single",
          inputs: [{ identifier: "input", type: "str" }],
          scenarioMappings: undefined,
        }),
      ).not.toThrow();
    });
  });

  describe("when the workflow has multiple inputs and mappings are configured", () => {
    it("does not throw", () => {
      expect(() =>
        mappings.validate({
          agentId: "agent-mapped",
          inputs: [
            { identifier: "query", type: "str" },
            { identifier: "context", type: "str" },
          ],
          scenarioMappings: {
            query: { type: "source", sourceId: "scenario", path: ["input"] },
            context: { type: "value", value: "static context" },
          },
        }),
      ).not.toThrow();
    });
  });

  describe("when the workflow has zero inputs and no mappings are configured", () => {
    it("does not throw (edge case — adapter synthesises a default input)", () => {
      expect(() =>
        mappings.validate({
          agentId: "agent-empty",
          inputs: [],
          scenarioMappings: undefined,
        }),
      ).not.toThrow();
    });
  });
});
