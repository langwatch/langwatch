/**
 * @vitest-environment node
 */

import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { Component } from "../../types/dsl";
import {
  applyMappingChangeToEdges,
  buildAvailableSources,
  buildInputMappingsFromEdges,
} from "../edgeMappingUtils";

function createNode(
  id: string,
  type: string,
  data: Partial<Component> = {},
): Node<Component> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      name: data.name ?? id,
      outputs: data.outputs ?? [],
      inputs: data.inputs ?? [],
      ...data,
    },
  };
}

function createEdge(
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
): Edge {
  return {
    id: `edge-${source}-${target}-${sourceHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  };
}

describe("buildAvailableSources", () => {
  describe("when there are upstream nodes with outputs", () => {
    it("includes them as available sources", () => {
      const nodes = [
        createNode("entry", "entry", {
          outputs: [{ identifier: "question", type: "str" }],
        }),
        createNode("llm1", "signature", {
          name: "LLM Node",
          outputs: [{ identifier: "answer", type: "str" }],
        }),
        createNode("end", "end", {}),
      ];
      const edges: Edge[] = [];

      const result = buildAvailableSources({
        nodeId: "llm1",
        nodes,
        edges,
      });

      expect(result).toEqual([
        {
          id: "entry",
          name: "Entry",
          type: "entry",
          fields: [{ name: "question", type: "str" }],
        },
      ]);
    });
  });

  describe("when a node is downstream", () => {
    it("excludes downstream nodes from sources", () => {
      const nodes = [
        createNode("entry", "entry", {
          outputs: [{ identifier: "input", type: "str" }],
        }),
        createNode("llm1", "signature", {
          name: "First LLM",
          outputs: [{ identifier: "result", type: "str" }],
        }),
        createNode("llm2", "signature", {
          name: "Second LLM",
          outputs: [{ identifier: "final", type: "str" }],
        }),
        createNode("end", "end", {}),
      ];
      const edges: Edge[] = [
        createEdge("llm1", "llm2", "outputs.result", "inputs.context"),
      ];

      const result = buildAvailableSources({
        nodeId: "llm1",
        nodes,
        edges,
      });

      // llm2 is downstream of llm1, should be excluded
      // llm1 itself is excluded (it's the target node)
      // end is always excluded
      expect(result).toEqual([
        {
          id: "entry",
          name: "Entry",
          type: "entry",
          fields: [{ name: "input", type: "str" }],
        },
      ]);
    });
  });

  describe("when the end node has no outputs", () => {
    it("excludes end node even if it were to have outputs", () => {
      const nodes = [
        createNode("entry", "entry", {
          outputs: [{ identifier: "input", type: "str" }],
        }),
        createNode("llm1", "signature", {}),
        createNode("end", "end", {
          outputs: [{ identifier: "result", type: "str" }],
        }),
      ];
      const edges: Edge[] = [];

      const result = buildAvailableSources({
        nodeId: "llm1",
        nodes,
        edges,
      });

      const ids = result.map((s) => s.id);
      expect(ids).not.toContain("end");
    });
  });

  describe("when a node has no outputs", () => {
    it("excludes nodes with no output fields", () => {
      const nodes = [
        createNode("entry", "entry", { outputs: [] }),
        createNode("llm1", "signature", {
          outputs: [{ identifier: "answer", type: "str" }],
        }),
      ];
      const edges: Edge[] = [];

      const result = buildAvailableSources({
        nodeId: "llm1",
        nodes,
        edges,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("when an entry node has a dataset attached", () => {
    /** @scenario A workflow input maps from the entry, not the dataset name */
    it("labels the source as Entry, not the dataset name", () => {
      const nodes = [
        createNode("entry", "entry", {
          outputs: [{ identifier: "question", type: "str" }],
          dataset: { name: "Customer FAQ" },
        } as Partial<Component>),
        createNode("llm1", "signature", {}),
      ];
      const edges: Edge[] = [];

      const result = buildAvailableSources({
        nodeId: "llm1",
        nodes,
        edges,
      });

      expect(result[0]!.name).toBe("Entry");
      expect(result[0]!.type).toBe("entry");
    });
  });
});

describe("buildInputMappingsFromEdges", () => {
  describe("when edges connect to the node", () => {
    it("builds mappings from edge handles", () => {
      const edges: Edge[] = [
        createEdge("entry", "llm1", "outputs.question", "inputs.input"),
        createEdge("entry", "llm1", "outputs.context", "inputs.context"),
      ];

      const result = buildInputMappingsFromEdges({
        nodeId: "llm1",
        edges,
      });

      expect(result).toEqual({
        input: { type: "source", sourceId: "entry", path: ["question"] },
        context: { type: "source", sourceId: "entry", path: ["context"] },
      });
    });
  });

  describe("when no edges target the node", () => {
    it("returns an empty mapping", () => {
      const edges: Edge[] = [
        createEdge("entry", "other_node", "outputs.data", "inputs.input"),
      ];

      const result = buildInputMappingsFromEdges({
        nodeId: "llm1",
        edges,
      });

      expect(result).toEqual({});
    });
  });

  describe("when edges have missing handles", () => {
    it("skips edges without valid handle parts", () => {
      const edges: Edge[] = [
        {
          id: "edge-1",
          source: "entry",
          target: "llm1",
          sourceHandle: null,
          targetHandle: "inputs.input",
        },
      ];

      const result = buildInputMappingsFromEdges({
        nodeId: "llm1",
        edges,
      });

      expect(result).toEqual({});
    });
  });
});

describe("applyMappingChangeToEdges", () => {
  describe("when adding a source mapping", () => {
    it("creates a new edge for the mapping", () => {
      const currentEdges: Edge[] = [];

      const result = applyMappingChangeToEdges({
        nodeId: "llm1",
        identifier: "question",
        mapping: {
          type: "source",
          sourceId: "entry",
          path: ["input"],
        },
        currentEdges,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: "entry",
        target: "llm1",
        sourceHandle: "outputs.input",
        targetHandle: "inputs.question",
        type: "default",
      });
    });
  });

  describe("when removing a mapping", () => {
    it("removes the existing edge for that input", () => {
      const currentEdges: Edge[] = [
        createEdge("entry", "llm1", "outputs.input", "inputs.question"),
        createEdge("entry", "llm1", "outputs.context", "inputs.context"),
      ];

      const result = applyMappingChangeToEdges({
        nodeId: "llm1",
        identifier: "question",
        mapping: undefined,
        currentEdges,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.targetHandle).toBe("inputs.context");
    });
  });

  describe("when replacing a mapping", () => {
    it("removes the old edge and adds a new one", () => {
      const currentEdges: Edge[] = [
        createEdge("entry", "llm1", "outputs.old_field", "inputs.question"),
      ];

      const result = applyMappingChangeToEdges({
        nodeId: "llm1",
        identifier: "question",
        mapping: {
          type: "source",
          sourceId: "retriever1",
          path: ["results"],
        },
        currentEdges,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: "retriever1",
        target: "llm1",
        sourceHandle: "outputs.results",
        targetHandle: "inputs.question",
      });
    });
  });

  describe("when mapping is a value type (not source)", () => {
    it("only removes existing edges without adding new ones", () => {
      const currentEdges: Edge[] = [
        createEdge("entry", "llm1", "outputs.input", "inputs.question"),
      ];

      const result = applyMappingChangeToEdges({
        nodeId: "llm1",
        identifier: "question",
        mapping: { type: "value", value: "static text" },
        currentEdges,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("when unrelated edges exist", () => {
    it("preserves edges not targeting this node input", () => {
      const currentEdges: Edge[] = [
        createEdge("entry", "llm1", "outputs.input", "inputs.question"),
        createEdge("entry", "llm2", "outputs.input", "inputs.context"),
      ];

      const result = applyMappingChangeToEdges({
        nodeId: "llm1",
        identifier: "question",
        mapping: undefined,
        currentEdges,
      });

      // Only the edge targeting llm1.inputs.question should be removed
      expect(result).toHaveLength(1);
      expect(result[0]!.target).toBe("llm2");
    });
  });
});
