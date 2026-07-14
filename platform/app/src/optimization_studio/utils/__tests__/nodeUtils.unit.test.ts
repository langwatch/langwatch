/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { getMappingSurfaceInputs, getInputsOutputs } from "../nodeUtils";
import type { Field } from "../../types/dsl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EntryOutput {
  identifier: string;
  type: Field["type"];
}

interface EndInput {
  identifier: string;
  type: Field["type"];
}

interface BuildWorkflowOptions {
  entryOutputs: EntryOutput[];
  endInputs?: EndInput[];
  edges?: Edge[];
}

function buildWorkflow({ entryOutputs, endInputs = [], edges = [] }: BuildWorkflowOptions): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        outputs: entryOutputs,
      },
    },
    {
      id: "llm1",
      type: "signature",
      position: { x: 200, y: 0 },
      data: { name: "LLM Call", inputs: [], outputs: [] },
    },
    {
      id: "eval1",
      type: "evaluator",
      position: { x: 200, y: 200 },
      data: { name: "Evaluator", inputs: [], outputs: [] },
    },
    {
      id: "end",
      type: "end",
      position: { x: 400, y: 0 },
      data: {
        name: "End",
        inputs: endInputs,
      },
    },
  ];

  return { nodes, edges };
}

function makeEdge(identifier: string, targetNodeId: string, edgeIndex: number): Edge {
  return {
    id: `edge-${edgeIndex}`,
    source: "entry",
    sourceHandle: `outputs.${identifier}`,
    target: targetNodeId,
    targetHandle: `inputs.${identifier}`,
  };
}

// ---------------------------------------------------------------------------
// getInputsOutputs — entry inputs
// ---------------------------------------------------------------------------

describe("getMappingSurfaceInputs", () => {
  describe("when entry node has wired fields", () => {
    /** @scenario Wired entry field still appears once in the drawer's mappable inputs */
    it("returns exactly one input for a wired non-evaluator field without the optional flag", () => {
      const { nodes, edges } = buildWorkflow({
        entryOutputs: [{ identifier: "query", type: "str" }],
        edges: [makeEdge("query", "llm1", 0)],
      });

      const inputs = getMappingSurfaceInputs(edges, nodes);

      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({ identifier: "query" });
      expect(inputs[0]).not.toHaveProperty("optional");
    });
  });

  describe("when entry node has evaluator-only wired fields", () => {
    /** @scenario Evaluator-only wired entry output keeps its optional flag */
    it("returns one input marked optional for a field wired only to an evaluator", () => {
      const { nodes, edges } = buildWorkflow({
        entryOutputs: [{ identifier: "eval_only", type: "str" }],
        edges: [makeEdge("eval_only", "eval1", 0)],
      });

      const inputs = getMappingSurfaceInputs(edges, nodes);

      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({ identifier: "eval_only", optional: true });
    });
  });

  describe("when entry node has a mix of wired and unwired fields", () => {
    /** @scenario Mixed wired and unwired entry fields all appear exactly once with correct flags */
    it("includes all three fields with correct optional flags", () => {
      const { nodes, edges } = buildWorkflow({
        entryOutputs: [
          { identifier: "wired", type: "str" },
          { identifier: "unwired", type: "str" },
          { identifier: "eval_only", type: "str" },
        ],
        edges: [
          makeEdge("wired", "llm1", 0),
          makeEdge("eval_only", "eval1", 1),
          // "unwired" has no downstream edge — this is the bug trigger
        ],
      });

      const inputs = getMappingSurfaceInputs(edges, nodes);

      expect(inputs).toHaveLength(3);

      const wiredInput = inputs.find((i) => i.identifier === "wired");
      const unwiredInput = inputs.find((i) => i.identifier === "unwired");
      const evalOnlyInput = inputs.find((i) => i.identifier === "eval_only");

      expect(wiredInput).toBeDefined();
      expect(wiredInput).not.toHaveProperty("optional");

      expect(unwiredInput).toBeDefined();
      expect(unwiredInput).not.toHaveProperty("optional");

      expect(evalOnlyInput).toBeDefined();
      expect(evalOnlyInput).toMatchObject({ optional: true });
    });
  });

  describe("when entry node has a field with no downstream edges", () => {
    /** @scenario Pure unwired entry field still appears as an input */
    it("returns the unwired field as an input without the optional flag", () => {
      const { nodes, edges } = buildWorkflow({
        entryOutputs: [{ identifier: "orphan_field", type: "str" }],
        edges: [], // no edges at all
      });

      const inputs = getMappingSurfaceInputs(edges, nodes);

      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({ identifier: "orphan_field" });
      expect(inputs[0]).not.toHaveProperty("optional");
    });
  });

});

// ---------------------------------------------------------------------------
// getInputsOutputs — end outputs (regression guard, end side is unaffected)
// ---------------------------------------------------------------------------

describe("getInputsOutputs", () => {
  describe("when end node declares inputs", () => {
    /** @scenario End-node outputs continue to derive from endNode.data.inputs unchanged */
    it("derives outputs from the end node's declared inputs unchanged", () => {
      const endInputs: EndInput[] = [
        { identifier: "response", type: "str" },
        { identifier: "score", type: "float" },
      ];

      const { nodes, edges } = buildWorkflow({
        entryOutputs: [{ identifier: "query", type: "str" }],
        endInputs,
        edges: [makeEdge("query", "llm1", 0)],
      });

      const { outputs } = getInputsOutputs(edges, nodes);

      expect(outputs).toEqual(endInputs);
    });
  });
});
