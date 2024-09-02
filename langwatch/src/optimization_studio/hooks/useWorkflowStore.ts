import {
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import { temporal } from "zundo";
import { create } from "zustand";
import isDeepEqual from "fast-deep-equal";
import debounce from "lodash.debounce";
import type {
  BaseComponent,
  Component,
  ComponentType,
  Workflow,
} from "../types/dsl";

export type SocketStatus = "disconnected" | "connecting" | "connected";

type WorkflowStore = Workflow & {
  hoveredNodeId?: string;
  socketStatus: SocketStatus;
  setSocketStatus: (status: SocketStatus) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setNode: (node: Partial<Node>) => void;
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"]
  ) => void;
  setHoveredNodeId: (nodeId: string | undefined) => void;
  selectNode: (nodeId: string) => void;
  deselectAllNodes: () => void;
};

const initialNodes: Node<Component>[] = [
  {
    id: "0",
    type: "entry",
    position: { x: 0, y: 0 },
    data: {
      name: "Entry",
      outputs: [
        { identifier: "question", type: "str" },
        { identifier: "gold_answer", type: "str" },
      ],
      dataset: {
        name: "Test Dataset",
        inline: {
          records: {
            question: [
              "What is the capital of the moon?",
              "What is the capital france?",
            ],
            gold_answer: [
              "The moon is made of cheese",
              "The capital of france is Paris",
            ],
          },
          columnTypes: [
            { name: "question", type: "string" },
            { name: "gold_answer", type: "string" },
          ],
        },
      },
    },
  },
  {
    id: "1",
    type: "signature",
    position: { x: 300, y: 300 },
    data: {
      name: "GenerateQuery",
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "query", type: "str" }],
    },
  },
  {
    id: "2",
    type: "signature",
    position: { x: 600, y: 300 },
    data: {
      name: "GenerateAnswer",
      inputs: [
        { identifier: "question", type: "str" },
        { identifier: "query", type: "str" },
      ],
      outputs: [{ identifier: "answer", type: "str" }],
    },
  },
] satisfies (Node<Component> & { type: ComponentType })[];

const initialEdges: Edge[] = [
  {
    id: "e1-2",
    source: "1",
    sourceHandle: "outputs.query",
    target: "2",
    targetHandle: "inputs.query",
    type: "default",
  },
] satisfies (Edge & { type: "default" })[];

const store = (
  set: (
    partial:
      | WorkflowStore
      | Partial<WorkflowStore>
      | ((state: WorkflowStore) => WorkflowStore | Partial<WorkflowStore>),
    replace?: boolean | undefined
  ) => void,
  get: () => WorkflowStore
): WorkflowStore => ({
  spec_version: "1.0",
  name: "Untitled Workflow",
  description: "",
  version: "0.1",
  nodes: initialNodes,
  edges: initialEdges,
  state: {},

  hoveredNodeId: undefined,
  socketStatus: "disconnected",
  setSocketStatus: (status: SocketStatus) => {
    set({ socketStatus: status });
  },
  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },
  setNodes: (nodes: Node[]) => {
    set({ nodes });
  },
  setEdges: (edges: Edge[]) => {
    set({ edges });
  },
  setNode: (node: Partial<Node>) => {
    set({
      nodes: get().nodes.map((n) => (n.id === node.id ? { ...n, ...node } : n)),
    });
  },
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"]
  ) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, execution_state: executionState } }
          : node
      ),
    });
  },
  setHoveredNodeId: (nodeId: string | undefined) => {
    set({ hoveredNodeId: nodeId });
  },
  selectNode: (nodeId: string) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId ? { ...node, selected: true } : node
      ),
    });
  },
  deselectAllNodes: () => {
    set({
      nodes: get().nodes.map((node) => ({ ...node, selected: false })),
    });
  },
});

export const useWorkflowStore = create<WorkflowStore>()(
  temporal(store, {
    partialize: (state) => {
      const state_ = {
        ...state,
        edges: state.edges.map((edge) => {
          const edge_ = { ...edge };
          delete edge_.selected;
          return edge_;
        }),
        nodes: state.nodes.map((node) => {
          const node_ = { ...node };
          delete node_.selected;
          return node_;
        }),
      };
      delete state_.hoveredNodeId;
      return state_;
    },
    handleSet: (handleSet) => {
      return debounce<typeof handleSet>(
        (pastState) => {
          if ((pastState as any).nodes?.some((node: Node) => node.dragging)) {
            return;
          }
          handleSet(pastState);
        },

        // Our goal is to store the previous state to mark it as a "history entry" whenever state changes,
        // however, sometimes two pieces of state change in a very short period of time, and we don't want to
        // create two or more entries on the undo. We then store the pastState as soon as the debounce begins,
        // and only try to store again if more than 100ms has passed since the last state change.
        100,
        { leading: true, trailing: false }
      );
    },
    equality: (pastState, currentState) => isDeepEqual(pastState, currentState),
  })
);
