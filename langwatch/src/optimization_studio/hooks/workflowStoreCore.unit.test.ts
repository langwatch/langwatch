import { describe, it, expect, beforeEach } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { createStore, type StoreApi } from "zustand";
import {
  removeInvalidEdges,
  store as storeCreator,
  type WorkflowStore,
} from "./workflowStoreCore";

/**
 * Helper to build a minimal Node with inputs/outputs fields.
 */
function makeNode({
  id,
  type = "component",
  inputs = [],
  outputs = [],
  parameters = [],
}: {
  id: string;
  type?: string;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
  parameters?: Array<{
    identifier: string;
    type: string;
    value?: unknown;
  }>;
}): Node {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      inputs,
      outputs,
      parameters,
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

describe("workflowStoreCore", () => {
  describe("removeInvalidEdges", () => {
    describe("when edges reference valid nodes and handles", () => {
      it("keeps the edges", () => {
        const nodes = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "nodeB",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];
        const edges = [
          makeEdge({
            source: "nodeA",
            target: "nodeB",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        const result = removeInvalidEdges({ nodes, edges });
        expect(result.edges).toHaveLength(1);
      });
    });

    describe("when an edge references a non-existent node", () => {
      it("removes the edge", () => {
        const nodes = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "output", type: "str" }],
          }),
        ];
        const edges = [
          makeEdge({
            source: "nodeA",
            target: "nodeB_GONE",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        const result = removeInvalidEdges({ nodes, edges });
        expect(result.edges).toHaveLength(0);
      });
    });
  });

  describe("setNode", () => {
    let testStore: StoreApi<WorkflowStore>;

    beforeEach(() => {
      testStore = createStore<WorkflowStore>(storeCreator as any);
    });

    describe("when renaming a node with newId", () => {
      it("preserves edges connected to the renamed node as source", () => {
        const nodes: Node[] = [
          makeNode({
            id: "old_name",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "nodeB",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];
        const edges: Edge[] = [
          makeEdge({
            source: "old_name",
            target: "nodeB",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        testStore.setState({ nodes, edges });

        testStore.getState().setNode(
          {
            id: "old_name",
            data: {
              outputs: [{ identifier: "output", type: "str" }],
            },
          } as Partial<Node> & { id: string },
          "new_name",
        );

        const state = testStore.getState();
        expect(state.nodes.find((n) => n.id === "new_name")).toBeTruthy();
        expect(state.nodes.find((n) => n.id === "old_name")).toBeFalsy();

        expect(state.edges).toHaveLength(1);
        expect(state.edges[0]!.source).toBe("new_name");
        expect(state.edges[0]!.target).toBe("nodeB");
      });

      it("preserves edges where renamed node is the target", () => {
        const nodes: Node[] = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "old_target",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];
        const edges: Edge[] = [
          makeEdge({
            source: "nodeA",
            target: "old_target",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        testStore.setState({ nodes, edges });

        testStore.getState().setNode(
          {
            id: "old_target",
            data: {
              inputs: [{ identifier: "input", type: "str" }],
            },
          } as Partial<Node> & { id: string },
          "new_target",
        );

        const state = testStore.getState();
        expect(state.edges).toHaveLength(1);
        expect(state.edges[0]!.source).toBe("nodeA");
        expect(state.edges[0]!.target).toBe("new_target");
      });

      it("updates parameter refs in other nodes", () => {
        const nodes: Node[] = [
          makeNode({
            id: "old_name",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "nodeB",
            inputs: [{ identifier: "input", type: "str" }],
            parameters: [
              {
                identifier: "some_param",
                type: "str",
                value: { ref: "old_name" },
              },
              {
                identifier: "other_param",
                type: "str",
                value: "plain_value",
              },
            ],
          }),
        ];
        const edges: Edge[] = [];

        testStore.setState({ nodes, edges });

        testStore.getState().setNode(
          {
            id: "old_name",
            data: {
              outputs: [{ identifier: "output", type: "str" }],
            },
          } as Partial<Node> & { id: string },
          "new_name",
        );

        const state = testStore.getState();
        const nodeB = state.nodes.find((n) => n.id === "nodeB");
        const params = nodeB?.data.parameters as Array<{
          identifier: string;
          value: unknown;
        }>;

        expect(
          params.find((p) => p.identifier === "some_param")?.value,
        ).toEqual({ ref: "new_name" });
        expect(
          params.find((p) => p.identifier === "other_param")?.value,
        ).toBe("plain_value");
      });
    });
  });
});
