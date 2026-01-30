/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import {
  getWorkflowEntryOutputs,
  canAutoMapAllFields,
} from "../workflowFields";
import type { Workflow } from "../../types/dsl";

describe("workflowFields", () => {
  describe("getWorkflowEntryOutputs", () => {
    it("extracts outputs from workflow entry node", () => {
      const workflow: Partial<Workflow> = {
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [
                { identifier: "input", type: "str" },
                { identifier: "output", type: "str" },
                { identifier: "score", type: "float" },
              ],
            },
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      expect(outputs).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "score", type: "float" },
      ]);
    });

    it("returns empty array when workflow is null", () => {
      expect(getWorkflowEntryOutputs(null)).toEqual([]);
    });

    it("returns empty array when workflow is undefined", () => {
      expect(getWorkflowEntryOutputs(undefined)).toEqual([]);
    });

    it("returns empty array when workflow has no nodes", () => {
      const workflow: Partial<Workflow> = {
        nodes: [],
      };

      expect(getWorkflowEntryOutputs(workflow as Workflow)).toEqual([]);
    });

    it("returns empty array when no entry node exists", () => {
      const workflow: Partial<Workflow> = {
        nodes: [
          {
            id: "end",
            type: "end",
            position: { x: 0, y: 0 },
            data: { name: "End" },
          },
        ],
      };

      expect(getWorkflowEntryOutputs(workflow as Workflow)).toEqual([]);
    });

    it("returns empty array when entry node has no outputs", () => {
      const workflow: Partial<Workflow> = {
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              // No outputs defined
            },
          },
        ],
      };

      expect(getWorkflowEntryOutputs(workflow as Workflow)).toEqual([]);
    });

    it("handles workflow with multiple nodes correctly", () => {
      const workflow: Partial<Workflow> = {
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [{ identifier: "question", type: "str" }],
            },
          },
          {
            id: "llm_call",
            type: "signature",
            position: { x: 100, y: 0 },
            data: {
              name: "LLM Call",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "response", type: "str" }],
            },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { name: "End" },
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Should only return entry node outputs
      expect(outputs).toEqual([{ identifier: "question", type: "str" }]);
    });
  });

  describe("canAutoMapAllFields", () => {
    it("returns true when all fields are auto-mappable", () => {
      const fields = [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
      ];

      expect(canAutoMapAllFields(fields)).toBe(true);
    });

    it("returns true for contexts field", () => {
      const fields = [
        { identifier: "input", type: "str" },
        { identifier: "contexts", type: "list" },
      ];

      expect(canAutoMapAllFields(fields)).toBe(true);
    });

    it("returns false when some fields cannot be auto-mapped", () => {
      const fields = [
        { identifier: "input", type: "str" },
        { identifier: "custom_field", type: "str" },
      ];

      expect(canAutoMapAllFields(fields)).toBe(false);
    });

    it("returns true for empty fields array", () => {
      expect(canAutoMapAllFields([])).toBe(true);
    });

    it("returns false for non-standard fields", () => {
      const fields = [
        { identifier: "question", type: "str" },
        { identifier: "answer", type: "str" },
      ];

      expect(canAutoMapAllFields(fields)).toBe(false);
    });
  });
});
