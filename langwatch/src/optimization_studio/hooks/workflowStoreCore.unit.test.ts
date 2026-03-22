import { describe, it, expect, beforeEach } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { createStore, type StoreApi } from "zustand";
import type { Workflow } from "../types/dsl";
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

    describe("when a node has an undefined handle group", () => {
      it("preserves edges (handle group not yet loaded)", () => {
        const nodes: ReturnType<typeof makeNode>[] = [
          {
            id: "nodeA",
            type: "component",
            position: { x: 0, y: 0 },
            data: {
              outputs: undefined,
            },
          } as any,
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

      it("preserves edges when target handle group is undefined", () => {
        const nodes: ReturnType<typeof makeNode>[] = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          {
            id: "nodeB",
            type: "component",
            position: { x: 0, y: 0 },
            data: {
              inputs: undefined,
            },
          } as any,
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

    describe("when a handle group is an array but the identifier is missing", () => {
      it("removes the edge for a missing source handle identifier", () => {
        const nodes = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "other_output", type: "str" }],
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
        expect(result.edges).toHaveLength(0);
      });

      it("removes the edge for a missing target handle identifier", () => {
        const nodes = [
          makeNode({
            id: "nodeA",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "nodeB",
            inputs: [{ identifier: "other_input", type: "str" }],
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

      it("preserves edges when renamed node is both source and target", () => {
        const nodes: Node[] = [
          makeNode({
            id: "middle",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "upstream",
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "downstream",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];
        const edges: Edge[] = [
          makeEdge({
            source: "upstream",
            target: "middle",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
          makeEdge({
            source: "middle",
            target: "downstream",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        testStore.setState({ nodes, edges });

        testStore.getState().setNode(
          {
            id: "middle",
            data: {
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          } as Partial<Node> & { id: string },
          "renamed_middle",
        );

        const state = testStore.getState();
        expect(state.nodes.find((n) => n.id === "renamed_middle")).toBeTruthy();
        expect(state.nodes.find((n) => n.id === "middle")).toBeFalsy();

        expect(state.edges).toHaveLength(2);

        const incomingEdge = state.edges.find(
          (e) => e.source === "upstream",
        );
        expect(incomingEdge?.target).toBe("renamed_middle");

        const outgoingEdge = state.edges.find(
          (e) => e.target === "downstream",
        );
        expect(outgoingEdge?.source).toBe("renamed_middle");
      });

    });

    describe("when updating a node without renaming", () => {
      it("does not wipe existing inputs when node.data.inputs is undefined", () => {
        const nodes: Node[] = [
          makeNode({
            id: "nodeA",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          }),
          makeNode({
            id: "nodeB",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];
        const edges: Edge[] = [
          makeEdge({
            source: "nodeA",
            target: "nodeB",
            sourceHandle: "outputs.output",
            targetHandle: "inputs.input",
          }),
        ];

        testStore.setState({ nodes, edges });

        testStore.getState().setNode({
          id: "nodeA",
          data: {
            inputs: undefined,
          },
        } as Partial<Node> & { id: string });

        const state = testStore.getState();
        const nodeA = state.nodes.find((n) => n.id === "nodeA");
        expect(nodeA?.data.inputs).toEqual([{ identifier: "input", type: "str" }]);
        // Edge survives because nodeA.outputs and nodeB.inputs still match the handles
        expect(state.edges).toHaveLength(1);
      });

      it("clears non-array fields when undefined is passed intentionally", () => {
        const nodes: Node[] = [
          makeNode({
            id: "nodeA",
            inputs: [{ identifier: "input", type: "str" }],
          }),
        ];

        testStore.setState({ nodes, edges: [] });

        // Simulate a node that has localConfig set
        testStore.getState().setNode({
          id: "nodeA",
          data: { localConfig: { someKey: "someValue" } },
        } as Partial<Node> & { id: string });

        let state = testStore.getState();
        let nodeA = state.nodes.find((n) => n.id === "nodeA");
        expect((nodeA?.data as Record<string, unknown>)["localConfig"]).toEqual({ someKey: "someValue" });

        // Now clear it by passing undefined
        testStore.getState().setNode({
          id: "nodeA",
          data: { localConfig: undefined },
        } as Partial<Node> & { id: string });

        state = testStore.getState();
        nodeA = state.nodes.find((n) => n.id === "nodeA");
        expect((nodeA?.data as Record<string, unknown>)["localConfig"]).toBeUndefined();
        // Array fields remain untouched
        expect(nodeA?.data.inputs).toEqual([{ identifier: "input", type: "str" }]);
      });
    });

    describe("when renaming a node with newId", () => {
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

  describe("isDraggingNode", () => {
    let testStore: StoreApi<WorkflowStore>;

    beforeEach(() => {
      testStore = createStore<WorkflowStore>(storeCreator as any);
    });

    describe("when initialized", () => {
      it("defaults to false", () => {
        expect(testStore.getState().isDraggingNode).toBe(false);
      });
    });

    describe("when setIsDraggingNode is called with true", () => {
      it("sets isDraggingNode to true", () => {
        testStore.getState().setIsDraggingNode(true);
        expect(testStore.getState().isDraggingNode).toBe(true);
      });
    });

    describe("when setIsDraggingNode is called with false after dragging", () => {
      it("resets isDraggingNode to false", () => {
        testStore.getState().setIsDraggingNode(true);
        testStore.getState().setIsDraggingNode(false);
        expect(testStore.getState().isDraggingNode).toBe(false);
      });
    });
  });

  describe("hasPendingChanges", () => {
    let testStore: StoreApi<WorkflowStore>;

    beforeEach(() => {
      testStore = createStore<WorkflowStore>(storeCreator as any);
    });

    describe("when workflow is loaded from DB and autosave baseline is set from normalized state", () => {
      it("reports no pending changes", () => {
        const dbDsl = {
          spec_version: "1.4" as const,
          name: "My Workflow",
          icon: "🧩",
          description: "A test workflow",
          version: "1.0",
          nodes: [
            makeNode({
              id: "node1",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            }),
          ],
          edges: [],
          default_llm: {
            model: "openai/gpt-4o-mini",
            max_tokens: 2048,
            temperature: 0,
            litellm_params: {},
          },
          template_adapter: "default",
          enable_tracing: true,
          workflow_type: "workflow" as const,
          state: {},
        };

        // Simulate the DB load sequence from [workflow].tsx
        testStore.getState().setAutosavedWorkflow(undefined);
        testStore.getState().setWorkflow({
          ...dbDsl,
          workflow_id: "wf_123",
          nodes: dbDsl.nodes.map((node: any) => ({
            ...node,
            selected: false,
          })),
        } as Partial<Workflow>);
        testStore.getState().setLastCommittedWorkflow(dbDsl as any);

        // Simulate the fix: set autosave baseline from normalized store state
        const loadedWorkflow = testStore.getState().getWorkflow();
        testStore.getState().setAutosavedWorkflow(loadedWorkflow);

        expect(testStore.getState().hasPendingChanges()).toBe(false);
      });
    });

    describe("when workflow is loaded from DB without setting autosave baseline", () => {
      it("reports no pending changes because autosavedWorkflow is undefined", () => {
        const dbDsl = {
          spec_version: "1.4" as const,
          name: "My Workflow",
          icon: "🧩",
          description: "",
          version: "1.0",
          nodes: [makeNode({ id: "node1" })],
          edges: [],
          default_llm: {
            model: "openai/gpt-4o-mini",
            max_tokens: 2048,
            temperature: 0,
            litellm_params: {},
          },
          template_adapter: "default",
          enable_tracing: true,
          workflow_type: "workflow" as const,
          state: {},
        };

        // Without the fix: autosavedWorkflow stays undefined
        testStore.getState().setAutosavedWorkflow(undefined);
        testStore.getState().setWorkflow({
          ...dbDsl,
          workflow_id: "wf_123",
        } as Partial<Workflow>);
        testStore.getState().setLastCommittedWorkflow(dbDsl as any);

        // hasPendingChanges returns false when autosavedWorkflow is undefined
        expect(testStore.getState().hasPendingChanges()).toBe(false);
      });
    });

    describe("when autosave baseline is set and user makes a change", () => {
      it("reports pending changes", () => {
        const dbDsl = {
          spec_version: "1.4" as const,
          name: "My Workflow",
          icon: "🧩",
          description: "",
          version: "1.0",
          nodes: [makeNode({ id: "node1" })],
          edges: [],
          default_llm: {
            model: "openai/gpt-4o-mini",
            max_tokens: 2048,
            temperature: 0,
            litellm_params: {},
          },
          template_adapter: "default",
          enable_tracing: true,
          workflow_type: "workflow" as const,
          state: {},
        };

        // Load from DB with fix applied
        testStore.getState().setAutosavedWorkflow(undefined);
        testStore.getState().setWorkflow({
          ...dbDsl,
          workflow_id: "wf_123",
        } as Partial<Workflow>);
        testStore.getState().setLastCommittedWorkflow(dbDsl as any);
        const loadedWorkflow = testStore.getState().getWorkflow();
        testStore.getState().setAutosavedWorkflow(loadedWorkflow);

        // User changes the name
        testStore.getState().setWorkflow({ name: "Renamed Workflow" });

        expect(testStore.getState().hasPendingChanges()).toBe(true);
      });
    });
  });
});
