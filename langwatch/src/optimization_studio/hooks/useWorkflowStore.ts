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
import throttle from "lodash.throttle";

interface WorkflowStore {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
}

const initialNodes: Node[] = [
  {
    id: "1",
    type: "component",
    position: { x: 300, y: 300 },
    data: { label: "1" },
  },
  {
    id: "2",
    type: "component",
    position: { x: 600, y: 300 },
    data: { label: "2" },
  },
];
const initialEdges: Edge[] = [{ id: "e1-2", source: "1", target: "2" }];

const store = (
  set: (
    partial:
      | WorkflowStore
      | Partial<WorkflowStore>
      | ((state: WorkflowStore) => WorkflowStore | Partial<WorkflowStore>),
    replace?: boolean | undefined
  ) => void,
  get: () => WorkflowStore
) => ({
  nodes: initialNodes,
  edges: initialEdges,
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
      return state_;
    },
    handleSet: (handleSet) => {
      return throttle<typeof handleSet>((state) => {
        if ((state as any).nodes?.some((node: Node) => node.dragging)) {
          return;
        }
        handleSet(state);
      }, 100);
    },
    equality: (pastState, currentState) => isDeepEqual(pastState, currentState),
  })
);
