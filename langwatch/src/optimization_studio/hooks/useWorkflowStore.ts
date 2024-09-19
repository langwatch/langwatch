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
  Field,
  LLMConfig,
  Workflow,
} from "../types/dsl";

export type SocketStatus =
  | "disconnected"
  | "connecting-socket"
  | "connecting-python"
  | "connected";

type State = Workflow & {
  workflowId?: string;
  hoveredNodeId?: string;
  socketStatus: SocketStatus;
  propertiesExpanded: boolean;
  triggerValidation: boolean;
  workflowSelected: boolean;
  previousWorkflow: Workflow | undefined;
};

type WorkflowStore = State & {
  reset: () => void;
  getWorkflow: () => Workflow;
  setWorkflow: (workflow: Partial<Workflow> & { workflowId?: string }) => void;
  setPreviousWorkflow: (workflow: Workflow | undefined) => void;
  setSocketStatus: (status: SocketStatus) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setNode: (node: Partial<Node> & { id: string }) => void;
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"]
  ) => void;
  setHoveredNodeId: (nodeId: string | undefined) => void;
  setSelectedNode: (nodeId: string) => void;
  deselectAllNodes: () => void;
  setPropertiesExpanded: (expanded: boolean) => void;
  setTriggerValidation: (triggerValidation: boolean) => void;
  setWorkflowSelected: (selected: boolean) => void;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  model: "openai/gpt-4o-mini",
  temperature: 0,
  max_tokens: 2048,
};

const initialState: State = {
  spec_version: "1.0",
  name: "Untitled Workflow",
  icon: "🧩",
  description: "",
  version: "0.1",
  nodes: [],
  edges: [],
  default_llm: DEFAULT_LLM_CONFIG,
  state: {},

  workflowId: undefined,
  hoveredNodeId: undefined,
  socketStatus: "disconnected",
  propertiesExpanded: false,
  triggerValidation: false,
  workflowSelected: false,
  previousWorkflow: undefined,
};

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
  ...initialState,
  reset() {
    set(initialState);
  },
  getWorkflow: () => {
    const state = get();

    // Keep only the keys present on Workflow type
    return {
      spec_version: state.spec_version,
      name: state.name,
      icon: state.icon,
      description: state.description,
      version: state.version,
      default_llm: state.default_llm,
      nodes: state.nodes,
      edges: state.edges,
      state: state.state,
    };
  },
  setWorkflow: (workflow: Partial<Workflow> & { workflowId?: string }) => {
    set(workflow);
  },
  setPreviousWorkflow: (workflow: Workflow | undefined) => {
    set({ previousWorkflow: workflow });
  },
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
      edges: addEdge(connection, get().edges).map((edge) => ({
        ...edge,
        type: edge.type ?? "default",
      })),
    });
  },
  setNodes: (nodes: Node[]) => {
    set({ nodes });
  },
  setEdges: (edges: Edge[]) => {
    set({ edges });
  },
  setNode: (node: Partial<Node> & { id: string }) => {
    set(
      removeInvalidEdges({
        nodes: get().nodes.map((n) =>
          n.id === node.id
            ? { ...n, ...node, data: { ...n.data, ...node.data } }
            : n
        ),
        edges: get().edges,
      })
    );
  },
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"]
  ) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id === id) {
          const current_execution_state = node.data.execution_state;
          const timestamps = current_execution_state?.timestamps;
          return {
            ...node,
            data: {
              ...node.data,
              execution_state: {
                ...(current_execution_state ?? {}),
                ...executionState,
                timestamps: {
                  ...(timestamps ?? {}),
                  ...(executionState?.timestamps ?? {}),
                },
              },
            },
          } as Node<Component>;
        }
        return node;
      }),
    });
  },
  setHoveredNodeId: (nodeId: string | undefined) => {
    set({ hoveredNodeId: nodeId });
  },
  setSelectedNode: (nodeId: string) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId ? { ...node, selected: true } : node
      ),
    });
  },
  deselectAllNodes: () => {
    set({
      nodes: get().nodes.map((node) => ({ ...node, selected: false })),
      workflowSelected: false,
    });
  },
  setPropertiesExpanded: (expanded: boolean) => {
    set({ propertiesExpanded: expanded });
  },
  setTriggerValidation: (triggerValidation: boolean) => {
    set({ triggerValidation });
  },
  setWorkflowSelected: (selected: boolean) => {
    set({ workflowSelected: selected });
    if (selected) {
      set({ nodes: get().nodes.map((node) => ({ ...node, selected: false })) });
    }
  },
});

export const useWorkflowStore = create<WorkflowStore>()(
  temporal(store, {
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
    equality: (pastState, currentState) => {
      const partialize = (state: WorkflowStore) => {
        const state_ = {
          name: state.name,
          icon: state.icon,
          description: state.description,
          version: undefined,
          default_llm: state.default_llm,
          edges: state.edges.map((edge) => {
            const edge_ = { ...edge };
            delete edge_.selected;
            return edge_;
          }),
          nodes: state.nodes.map((node) => {
            const node_ = { ...node, data: { ...node.data } };
            delete node_.selected;
            delete node_.data.execution_state;
            return node_;
          }),
        };
        return state_;
      };
      return isDeepEqual(partialize(pastState), partialize(currentState));
    },
  })
);

export const removeInvalidEdges = ({
  nodes,
  edges,
}: {
  nodes: Node[];
  edges: Edge[];
}) => {
  return {
    nodes,
    edges: edges.filter((edge) => {
      const source = nodes.find((node) => node.id === edge.source);
      const [sourceHandleGroup, sourceHandleIdentifier] =
        edge.sourceHandle?.split(".") ?? [null, null];
      const sourceHandle = (
        source?.data[sourceHandleGroup as any] as Field[]
      )?.find((field) => field.identifier === sourceHandleIdentifier);

      const target = nodes.find((node) => node.id === edge.target);
      const [targetHandleGroup, targetHandleIdentifier] =
        edge.targetHandle?.split(".") ?? [null, null];
      const targetHandle = (
        target?.data[targetHandleGroup as any] as Field[]
      )?.find((field) => field.identifier === targetHandleIdentifier);

      return source && target && sourceHandle && targetHandle;
    }),
  };
};
