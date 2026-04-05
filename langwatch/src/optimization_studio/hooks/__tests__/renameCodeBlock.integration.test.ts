import { describe, it, expect, beforeEach } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { createStore, type StoreApi } from "zustand";
import {
  store as storeCreator,
  type WorkflowStore,
} from "../workflowStoreCore";

function makeCodeNode({
  id,
  name,
  code,
  inputs = [],
  outputs = [],
}: {
  id: string;
  name: string;
  code: string;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
}): Node {
  return {
    id,
    type: "code",
    position: { x: 0, y: 0 },
    data: {
      name,
      inputs,
      outputs,
      parameters: [{ identifier: "code", type: "code", value: code }],
    },
  } as Node;
}

function makeEdge({
  source,
  target,
  sourceHandle,
  targetHandle,
}: {
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}): Edge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "default",
  };
}

describe("rename code blocks", () => {
  let testStore: StoreApi<WorkflowStore>;

  beforeEach(() => {
    testStore = createStore<WorkflowStore>(storeCreator as any);
  });

  describe("when renaming a code block via setNode", () => {
    it("updates the node name and id", () => {
      const nodes = [
        makeCodeNode({
          id: "code1",
          name: "code1",
          code: 'class Code1(dspy.Module):\n    def forward(self, input: str):\n        return {"output": input}',
        }),
      ];
      testStore.setState({ nodes, edges: [] });

      testStore.getState().setNode(
        { id: "code1", data: { name: "data_processor" } },
        "data_processor",
      );

      const state = testStore.getState();
      const node = state.nodes.find((n) => n.id === "data_processor");
      expect(node).toBeTruthy();
      expect(node?.data.name).toBe("data_processor");
      expect(state.nodes.find((n) => n.id === "code1")).toBeFalsy();
    });

    it("updates the Python class name in the code", () => {
      const nodes = [
        makeCodeNode({
          id: "code1",
          name: "code1",
          code: 'class Code1(dspy.Module):\n    def forward(self, input: str):\n        return {"output": input}',
        }),
      ];
      testStore.setState({ nodes, edges: [] });

      testStore.getState().setNode(
        { id: "code1", data: { name: "data_processor" } },
        "data_processor",
      );

      const state = testStore.getState();
      const node = state.nodes.find((n) => n.id === "data_processor");
      const codeParam = (node?.data.parameters as any[])?.find(
        (p: any) => p.identifier === "code",
      );
      expect(codeParam?.value).toContain("class DataProcessor(dspy.Module):");
    });

    it("updates connected edge references", () => {
      const nodes = [
        makeCodeNode({
          id: "code1",
          name: "code1",
          code: "class Code1(dspy.Module):\n    pass",
          outputs: [{ identifier: "output", type: "str" }],
        }),
        {
          id: "nodeB",
          type: "component",
          position: { x: 0, y: 0 },
          data: {
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [],
          },
        } as Node,
      ];
      const edges = [
        makeEdge({
          source: "code1",
          target: "nodeB",
          sourceHandle: "outputs.output",
          targetHandle: "inputs.input",
        }),
      ];
      testStore.setState({ nodes, edges });

      testStore.getState().setNode(
        {
          id: "code1",
          data: {
            name: "data_processor",
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
        "data_processor",
      );

      const state = testStore.getState();
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0]!.source).toBe("data_processor");
      expect(state.edges[0]!.target).toBe("nodeB");
    });
  });

  describe("when duplicating a code block", () => {
    it("gives the duplicate a unique name", () => {
      const nodes = [
        makeCodeNode({
          id: "code1",
          name: "code1",
          code: "class Code1(dspy.Module):\n    pass",
        }),
      ];
      testStore.setState({ nodes, edges: [] });

      testStore.getState().duplicateNode("code1");

      const state = testStore.getState();
      expect(state.nodes).toHaveLength(2);
      const duplicate = state.nodes.find((n) => n.id !== "code1");
      expect(duplicate).toBeTruthy();
      expect(duplicate!.id).not.toBe("code1");
    });

    it("updates the Python class name in the duplicated code", () => {
      const nodes = [
        makeCodeNode({
          id: "code1",
          name: "code1",
          code: 'class Code1(dspy.Module):\n    def forward(self, input: str):\n        return {"output": input}',
        }),
      ];
      testStore.setState({ nodes, edges: [] });

      testStore.getState().duplicateNode("code1");

      const state = testStore.getState();
      const duplicate = state.nodes.find((n) => n.id !== "code1");
      const codeParam = (duplicate?.data.parameters as any[])?.find(
        (p: any) => p.identifier === "code",
      );
      expect(codeParam?.value).not.toContain("class Code1(dspy.Module):");
    });

    it("bases the new name on a renamed block's current name", () => {
      const nodes = [
        makeCodeNode({
          id: "data_processor",
          name: "data_processor",
          code: "class DataProcessor(dspy.Module):\n    pass",
        }),
      ];
      testStore.setState({ nodes, edges: [] });

      testStore.getState().duplicateNode("data_processor");

      const state = testStore.getState();
      const duplicate = state.nodes.find((n) => n.id !== "data_processor");
      expect(duplicate).toBeTruthy();
      expect(duplicate!.id).toContain("data_processor");
    });
  });
});
