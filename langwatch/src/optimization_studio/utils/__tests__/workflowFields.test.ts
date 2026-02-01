/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import {
  getWorkflowEntryOutputs,
  canAutoMapAllFields,
  isOutputConnectedToNonEvaluator,
} from "../workflowFields";
import type { Workflow, Component } from "../../types/dsl";

describe("workflowFields", () => {
  describe("isOutputConnectedToNonEvaluator", () => {
    const createNode = (
      id: string,
      type: string,
      behaveAs?: "evaluator",
    ): Node<Component> =>
      ({
        id,
        type,
        position: { x: 0, y: 0 },
        data: { behave_as: behaveAs },
      }) as Node<Component>;

    const createEdge = (
      source: string,
      target: string,
      sourceHandle: string,
    ): Edge => ({
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle,
    });

    it("returns false when output has no edges (unused)", () => {
      const edges: Edge[] = [];
      const nodes: Node<Component>[] = [createNode("entry", "entry")];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(false);
    });

    it("returns false when output only connects to evaluator node", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("eval1", "evaluator"),
      ];
      const edges: Edge[] = [createEdge("entry", "eval1", "outputs.input")];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(false);
    });

    it("returns false when output only connects to node with behave_as evaluator", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("custom1", "custom", "evaluator"),
      ];
      const edges: Edge[] = [createEdge("entry", "custom1", "outputs.input")];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(false);
    });

    it("returns true when output connects to non-evaluator node", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("sig1", "signature"),
      ];
      const edges: Edge[] = [createEdge("entry", "sig1", "outputs.input")];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(true);
    });

    it("returns true when output connects to both evaluator and non-evaluator nodes", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("sig1", "signature"),
        createNode("eval1", "evaluator"),
      ];
      const edges: Edge[] = [
        createEdge("entry", "sig1", "outputs.input"),
        createEdge("entry", "eval1", "outputs.input"),
      ];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(true);
    });

    it("returns false when multiple evaluator nodes receive same output", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("eval1", "evaluator"),
        createNode("eval2", "evaluator"),
      ];
      const edges: Edge[] = [
        createEdge("entry", "eval1", "outputs.input"),
        createEdge("entry", "eval2", "outputs.input"),
      ];

      const result = isOutputConnectedToNonEvaluator("input", edges, nodes);

      expect(result).toBe(false);
    });

    it("checks correct output identifier", () => {
      const nodes: Node<Component>[] = [
        createNode("entry", "entry"),
        createNode("sig1", "signature"),
        createNode("eval1", "evaluator"),
      ];
      const edges: Edge[] = [
        createEdge("entry", "sig1", "outputs.input"),
        createEdge("entry", "eval1", "outputs.expected_output"),
      ];

      // "input" connects to signature (non-evaluator) - should be included
      expect(isOutputConnectedToNonEvaluator("input", edges, nodes)).toBe(true);
      // "expected_output" only connects to evaluator - should be excluded
      expect(
        isOutputConnectedToNonEvaluator("expected_output", edges, nodes),
      ).toBe(false);
    });
  });

  describe("getWorkflowEntryOutputs", () => {
    it("extracts outputs from workflow entry node when connected to non-evaluators", () => {
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
          {
            id: "sig1",
            type: "signature",
            position: { x: 100, y: 0 },
            data: { name: "LLM Call" },
          },
        ],
        edges: [
          { id: "e1", source: "entry", target: "sig1", sourceHandle: "outputs.input" },
          { id: "e2", source: "entry", target: "sig1", sourceHandle: "outputs.output" },
          { id: "e3", source: "entry", target: "sig1", sourceHandle: "outputs.score" },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      expect(outputs).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "score", type: "float" },
      ]);
    });

    it("filters out outputs with no connections (unused outputs)", () => {
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
                { identifier: "unused_field", type: "str" },
              ],
            },
          },
          {
            id: "sig1",
            type: "signature",
            position: { x: 100, y: 0 },
            data: { name: "LLM Call" },
          },
        ],
        edges: [
          // Only "input" is connected, "unused_field" has no connections
          { id: "e1", source: "entry", target: "sig1", sourceHandle: "outputs.input" },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Only "input" should be returned - "unused_field" is not connected
      expect(outputs).toEqual([{ identifier: "input", type: "str" }]);
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

    it("returns all outputs when workflow has no edges (legacy workflow)", () => {
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
              ],
            },
          },
        ],
        edges: [], // No edges at all
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Should return all outputs when there are no edges (legacy fallback)
      expect(outputs).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
      ]);
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
        edges: [
          // Connect outputs.question to llm_call
          { id: "e1", source: "entry", target: "llm_call", sourceHandle: "outputs.question" },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Should only return entry node outputs that are connected to non-evaluators
      expect(outputs).toEqual([{ identifier: "question", type: "str" }]);
    });

    it("filters out outputs that only connect to evaluators", () => {
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
                { identifier: "expected_output", type: "str" },
                { identifier: "unbiased", type: "bool" },
              ],
            },
          },
          {
            id: "sig1",
            type: "signature",
            position: { x: 100, y: 0 },
            data: { name: "LLM Call" },
          },
          {
            id: "eval1",
            type: "evaluator",
            position: { x: 100, y: 100 },
            data: { name: "Evaluator" },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            target: "sig1",
            sourceHandle: "outputs.input",
          },
          {
            id: "e2",
            source: "entry",
            target: "eval1",
            sourceHandle: "outputs.expected_output",
          },
          {
            id: "e3",
            source: "entry",
            target: "eval1",
            sourceHandle: "outputs.unbiased",
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Only "input" should be returned - expected_output and unbiased only connect to evaluator
      expect(outputs).toEqual([{ identifier: "input", type: "str" }]);
    });

    it("keeps outputs connected to both evaluator and non-evaluator", () => {
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
                { identifier: "expected_output", type: "str" },
              ],
            },
          },
          {
            id: "sig1",
            type: "signature",
            position: { x: 100, y: 0 },
            data: { name: "LLM Call" },
          },
          {
            id: "eval1",
            type: "evaluator",
            position: { x: 100, y: 100 },
            data: { name: "Evaluator" },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            target: "sig1",
            sourceHandle: "outputs.input",
          },
          {
            id: "e2",
            source: "entry",
            target: "sig1",
            sourceHandle: "outputs.expected_output",
          },
          {
            id: "e3",
            source: "entry",
            target: "eval1",
            sourceHandle: "outputs.expected_output",
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Both should be kept since expected_output also connects to sig1
      expect(outputs).toEqual([
        { identifier: "input", type: "str" },
        { identifier: "expected_output", type: "str" },
      ]);
    });

    it("handles nodes with behave_as evaluator", () => {
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
                { identifier: "bias_category", type: "str" },
              ],
            },
          },
          {
            id: "sig1",
            type: "signature",
            position: { x: 100, y: 0 },
            data: { name: "LLM Call" },
          },
          {
            id: "custom1",
            type: "custom",
            position: { x: 100, y: 100 },
            data: { name: "Custom Evaluator", behave_as: "evaluator" },
          },
        ],
        edges: [
          {
            id: "e1",
            source: "entry",
            target: "sig1",
            sourceHandle: "outputs.input",
          },
          {
            id: "e2",
            source: "entry",
            target: "custom1",
            sourceHandle: "outputs.bias_category",
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // bias_category should be filtered out (connects only to custom with behave_as evaluator)
      expect(outputs).toEqual([{ identifier: "input", type: "str" }]);
    });

    it("matches real Bias Detection workflow scenario - only answer is connected to non-evaluator", () => {
      // This test matches the exact scenario from the user's database:
      // - question: not connected
      // - answer: connected to llm_call (signature, non-evaluator)
      // - unbiased: connected only to exact_match (evaluator)
      // - bias_category: not connected
      const workflow: Partial<Workflow> = {
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              outputs: [
                { identifier: "question", type: "str" },
                { identifier: "answer", type: "str" },
                { identifier: "unbiased", type: "bool" },
                { identifier: "bias_category", type: "str" },
              ],
            },
          },
          {
            id: "llm_call",
            type: "signature",
            position: { x: 230, y: 0 },
            data: { name: "Sample LLM Bias Detection" },
          },
          {
            id: "exact_match",
            type: "evaluator",
            position: { x: 580, y: 155 },
            data: { name: "ExactMatch", evaluator: "langevals/exact_match" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 600, y: 0 },
            data: { name: "End", behave_as: "evaluator" },
          },
        ],
        edges: [
          // Only "answer" connects to non-evaluator (llm_call)
          {
            id: "e0-1",
            type: "default",
            source: "entry",
            target: "llm_call",
            sourceHandle: "outputs.answer",
            targetHandle: "inputs.llm_output",
          },
          // "unbiased" connects only to evaluator (exact_match)
          {
            id: "e3-4",
            type: "default",
            source: "entry",
            target: "exact_match",
            sourceHandle: "outputs.unbiased",
            targetHandle: "inputs.expected_output",
          },
          // Other edges (not from entry)
          {
            id: "e1-2",
            type: "default",
            source: "llm_call",
            target: "end",
            sourceHandle: "outputs.reasoning",
            targetHandle: "inputs.details",
          },
        ],
      };

      const outputs = getWorkflowEntryOutputs(workflow as Workflow);

      // Only "answer" should be returned:
      // - question: not connected → filtered out
      // - answer: connected to llm_call (non-evaluator) → included
      // - unbiased: connected only to exact_match (evaluator) → filtered out
      // - bias_category: not connected → filtered out
      expect(outputs).toEqual([{ identifier: "answer", type: "str" }]);
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
