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
import { findLowestAvailableName } from "../utils/nodeUtils";
import { snakeCaseToPascalCase } from "../../utils/stringCasing";

export type SocketStatus =
  | "disconnected"
  | "connecting-socket"
  | "connecting-python"
  | "connected";

type State = Workflow & {
  workflow_id?: string;
  hoveredNodeId?: string;
  socketStatus: SocketStatus;
  propertiesExpanded: boolean;
  triggerValidation: boolean;
  workflowSelected: boolean;
  previousWorkflow: Workflow | undefined;
  openResultsPanelRequest:
    | "evaluations"
    | "optimizations"
    | "closed"
    | undefined;
  playgroundOpen: boolean;
  textExpanded?: string;
};

type WorkflowStore = State & {
  reset: () => void;
  getWorkflow: () => Workflow;
  setWorkflow: (workflow: Partial<Workflow> & { workflowId?: string }) => void;
  setPreviousWorkflow: (workflow: Workflow | undefined) => void;
  setSocketStatus: (
    status: SocketStatus | ((status: SocketStatus) => SocketStatus)
  ) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodesDelete: () => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setNode: (node: Partial<Node> & { id: string }, newId?: string) => void;
  setNodeParameter: (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: any;
    }
  ) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"]
  ) => void;
  setWorkflowExecutionState: (
    executionState: Partial<Workflow["state"]["execution"]>
  ) => void;
  setEvaluationState: (
    evaluationState: Partial<Workflow["state"]["evaluation"]>
  ) => void;
  setOptimizationState: (
    optimizationState: Partial<Workflow["state"]["optimization"]>
  ) => void;
  setHoveredNodeId: (nodeId: string | undefined) => void;
  setSelectedNode: (nodeId: string) => void;
  deselectAllNodes: () => void;
  setPropertiesExpanded: (expanded: boolean) => void;
  setTriggerValidation: (triggerValidation: boolean) => void;
  setWorkflowSelected: (selected: boolean) => void;
  setOpenResultsPanelRequest: (
    request: "evaluations" | "optimizations" | "closed" | undefined
  ) => void;
  setPlaygroundOpen: (open: boolean) => void;
  setTextExpanded: (text: string | undefined) => void;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  model: "openai/gpt-4o-mini",
  temperature: 0,
  max_tokens: 2048,
};

const initialState: State = {
  workflow_id: undefined,
  spec_version: "1.2",
  name: "Loading...",
  icon: "🧩",
  description: "",
  version: "0.1",
  nodes: [],
  edges: [],
  default_llm: DEFAULT_LLM_CONFIG,
  state: {},

  hoveredNodeId: undefined,
  socketStatus: "disconnected",
  propertiesExpanded: false,
  triggerValidation: false,
  workflowSelected: false,
  previousWorkflow: undefined,
  openResultsPanelRequest: undefined,
  playgroundOpen: false,
  textExpanded: undefined,
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
      workflow_id: state.workflow_id,
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
  setWorkflow: (workflow: Partial<Workflow>) => {
    set(workflow);
  },
  setPreviousWorkflow: (workflow: Workflow | undefined) => {
    set({ previousWorkflow: workflow });
  },
  setSocketStatus: (
    status: SocketStatus | ((status: SocketStatus) => SocketStatus)
  ) => {
    set({
      socketStatus:
        typeof status === "function" ? status(get().socketStatus) : status,
    });
  },
  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onNodesDelete: () => {
    set({
      nodes: removeInvalidDecorations(get().nodes),
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
  setNode: (node: Partial<Node> & { id: string }, newId?: string) => {
    set(
      removeInvalidEdges({
        nodes: get().nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                ...node,
                data: {
                  ...n.data,
                  ...node.data,
                  ...(newId && n.type === "code"
                    ? {
                        parameters: updateCodeClassName(
                          (node.data?.parameters as Field[]) ??
                            n.data?.parameters ??
                            [],
                          n.id,
                          newId
                        ),
                      }
                    : {}),
                  ...((node.data?.inputs || node.data?.outputs) &&
                  n.type === "code"
                    ? {
                        parameters: updateOutputFields(
                          updateInputFields(
                            (node.data?.parameters as Field[]) ??
                              n.data?.parameters ??
                              [],
                            (node.data?.inputs ?? []) as Field[]
                          ),
                          n.data.outputs ?? [],
                          (node.data?.outputs ?? []) as Field[]
                        ),
                      }
                    : {}),
                },
                id: newId ? newId : n.id,
              }
            : n
        ),
        edges: get().edges,
      })
    );
  },
  setNodeParameter: (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: any;
    }
  ) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        const existingParameter = node.data.parameters?.find(
          (p) => p.identifier === parameter.identifier
        );

        return {
          ...node,
          data: {
            ...node.data,
            parameters: existingParameter
              ? (node.data.parameters ?? []).map((p) =>
                  p.identifier === parameter.identifier
                    ? { ...p, ...parameter }
                    : p
                )
              : [...(node.data.parameters ?? []), parameter],
          },
        };
      }) as Node<Component>[],
    });
  },
  deleteNode: (id: string) => {
    set(
      removeInvalidEdges({
        nodes: removeInvalidDecorations(
          get().nodes.filter((node) => node.id !== id)
        ),
        edges: get().edges,
      })
    );
  },
  duplicateNode: (id: string) => {
    const currentNode = get().nodes.find((node) => node.id === id);
    if (!currentNode) {
      return;
    }

    const { name: newName, id: newId } = findLowestAvailableName(
      get().nodes,
      currentNode.data.name?.replace(/ \(.*?\)$/, "") ?? "Component"
    );

    const newNode = {
      ...currentNode,
      id: newId,
      selected: false,
      dragging: false,
      measured: undefined,
      position: {
        x: currentNode.position.x + 250 + Math.round(Math.random() * 20),
        y: currentNode.position.y + Math.round(Math.random() * 20),
      },
      data: {
        ...currentNode.data,
        name: newName,
        execution_state: undefined,
      },
    };
    set({
      nodes: [...get().nodes, newNode],
    });
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
                ...(executionState?.error
                  ? { error: executionState.error.slice(0, 140) }
                  : {}),
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
  setWorkflowExecutionState: (
    executionState: Partial<Workflow["state"]["execution"]>
  ) => {
    set({
      state: {
        ...get().state,
        execution: {
          ...(get().state.execution ?? {}),
          ...executionState,
          ...(executionState?.error
            ? { error: executionState.error.slice(0, 140) }
            : {}),
        } as Workflow["state"]["execution"],
      },
    });
  },
  setEvaluationState: (
    evaluationState: Partial<Workflow["state"]["evaluation"]>
  ) => {
    set({
      state: {
        ...get().state,
        evaluation: {
          ...(get().state.evaluation ?? {}),
          ...evaluationState,
          ...(evaluationState?.error
            ? { error: evaluationState.error.slice(0, 140) }
            : {}),
        },
      },
    });
  },
  setOptimizationState: (
    optimizationState: Partial<Workflow["state"]["optimization"]>
  ) => {
    set({
      state: {
        ...get().state,
        optimization: {
          ...(get().state.optimization ?? {}),
          ...optimizationState,
          ...(optimizationState?.error
            ? { error: optimizationState.error.slice(0, 140) }
            : {}),
          ...(optimizationState?.stdout
            ? {
                stdout: (() => {
                  const stdout =
                    get().state.optimization?.stdout?.trimStart() ?? "";
                  const hasCarriageReturn =
                    optimizationState.stdout?.startsWith("\r") ||
                    stdout.endsWith("\r\n");

                  if (hasCarriageReturn) {
                    return (
                      stdout
                        .split("\n")
                        .slice(0, -2)
                        .join("\n")
                        .replaceAll("\r", "") +
                      "\n" +
                      optimizationState.stdout +
                      "\n"
                    );
                  }

                  return stdout + optimizationState.stdout + "\n";
                })(),
              }
            : {}),
        },
      },
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
  setOpenResultsPanelRequest: (request) => {
    set({ openResultsPanelRequest: request });
  },
  setPlaygroundOpen: (open: boolean) => {
    set({ playgroundOpen: open });
  },
  setTextExpanded: (text: string | undefined) => {
    set({ textExpanded: text });
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

export const removeInvalidDecorations = (nodes: Node[]) => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return nodes.map((node) => {
    if (node.data.parameters) {
      return {
        ...node,
        data: {
          ...node.data,
          parameters: (node.data.parameters as Field[]).map((p) =>
            (p.value as { ref: string })?.ref &&
            !nodeIds.has((p.value as { ref: string }).ref)
              ? { ...p, value: undefined }
              : p
          ),
        },
      };
    }
    return node;
  });
};

export const updateCodeClassName = (
  parameters: Field[],
  _oldId: string,
  newId: string
): Field[] => {
  return parameters.map((p) =>
    p.identifier === "code"
      ? {
          ...p,
          value: (p.value as string).replace(
            /class .*?\(dspy\.Module\):/,
            `class ${snakeCaseToPascalCase(newId)}(dspy.Module):`
          ),
        }
      : p
  );
};

const typesMap: Record<Field["type"], string> = {
  str: "str",
  int: "int",
  float: "float",
  bool: "bool",
  image: "dspy.Image",
  "list[str]": "list[str]",
  "list[float]": "list[float]",
  "list[int]": "list[int]",
  "list[bool]": "list[bool]",
  dict: "dict[str, Any]",
  signature: "dspy.Signature",
  llm: "Any",
  prompting_technique: "Any",
  dataset: "Any",
  code: "str",
};

export const updateInputFields = (parameters: Field[], inputs: Field[]) => {
  if (inputs.length === 0) {
    return parameters;
  }

  return parameters.map((p) => {
    if (p.identifier === "code") {
      let code = (p.value as string).replace(
        /def forward\([\s\S]*?\):/,
        `def forward(self, ${inputs
          .map((i) => `${i.identifier}: ${typesMap[i.type]}`)
          .join(", ")}):`
      );
      if (code.includes(": Any") && !code.includes("from typing import Any")) {
        code = `from typing import Any\n${code}`;
      }
      return {
        ...p,
        value: code,
      };
    }
    return p;
  });
};

export const updateOutputFields = (
  parameters: Field[],
  previousOutputs: Field[],
  outputs: Field[]
) => {
  if (previousOutputs.length !== outputs.length) {
    return parameters;
  }

  return parameters.map((p) => {
    if (p.identifier === "code") {
      let code = p.value as string;
      for (const [index, output] of outputs.entries()) {
        code = code.replace(
          new RegExp(
            `(return[\\s\\n\\t]+?\\{[^\\}]*?)"${previousOutputs[index]?.identifier}"`
          ),
          `$1"${output.identifier}"`
        );
      }

      return {
        ...p,
        value: code,
      };
    }
    return p;
  });
};
