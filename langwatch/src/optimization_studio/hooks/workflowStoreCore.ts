/**
 * Core workflow store logic extracted to break circular dependency between
 * useWorkflowStore and useEvaluationWizardStore.
 *
 * This file contains:
 * - Types (State, WorkflowStore, SocketStatus)
 * - Initial state values
 * - The store creator function
 * - Helper functions used by the store
 */

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { DEFAULT_MAX_TOKENS } from "~/utils/constants";
import { LlmConfigInputTypes } from "../../types";
import type {
  BaseComponent,
  Component,
  Field,
  LLMConfig,
  Workflow,
} from "../types/dsl";
import { hasDSLChanged } from "../utils/dslUtils";
import { findLowestAvailableName, nameToId } from "../utils/nodeUtils";

export type SocketStatus = "disconnected" | "connecting-python" | "connected";

export type State = Workflow & {
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
};

export type WorkflowStore = State & {
  reset: () => void;
  getWorkflow: () => Workflow;
  getPreviousWorkflow: () => Workflow | undefined;
  hasPendingChanges: () => boolean;
  setWorkflow: (
    workflow:
      | (Partial<Workflow> & { workflow_id?: string })
      | ((current: Workflow) => Partial<Workflow> & { workflow_id?: string }),
  ) => void;
  setPreviousWorkflow: (workflow: Workflow | undefined) => void;
  setSocketStatus: (
    status: SocketStatus | ((status: SocketStatus) => SocketStatus),
  ) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodesDelete: () => void;
  onConnect: (connection: Connection) => { error?: string } | undefined;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  edgeConnectToNewHandle: (
    source: string,
    sourceHandle: string,
    target: string,
  ) => string;
  /**
   * Update a node in the workflow.
   * This will find the node by id and update it.
   * If the id is not found, nothing will be updated.
   * @param node - The new node data
   * @param newId - Optional new id for the node once it updated
   */
  setNode: (node: Partial<Node> & { id: string }, newId?: string) => void;
  setNodeParameter: (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: any;
    },
  ) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  setComponentExecutionState: (
    id: string,
    executionState: BaseComponent["execution_state"],
  ) => void;
  setWorkflowExecutionState: (
    executionState: Partial<Workflow["state"]["execution"]>,
  ) => void;
  setEvaluationState: (
    evaluationState: Partial<Workflow["state"]["evaluation"]>,
  ) => void;
  setOptimizationState: (
    optimizationState: Partial<Workflow["state"]["optimization"]>,
  ) => void;
  setHoveredNodeId: (nodeId: string | undefined) => void;
  setSelectedNode: (nodeId: string) => void;
  deselectAllNodes: () => void;
  setPropertiesExpanded: (expanded: boolean) => void;
  setTriggerValidation: (triggerValidation: boolean) => void;
  setWorkflowSelected: (selected: boolean) => void;
  setOpenResultsPanelRequest: (
    request: "evaluations" | "optimizations" | "closed" | undefined,
  ) => void;
  setPlaygroundOpen: (open: boolean) => void;
  stopWorkflowIfRunning: (message: string | undefined) => void;
  checkIfUnreachableErrorMessage: (message: string | undefined) => void;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  model: "openai/gpt-5",
  temperature: 1.0,
  max_tokens: DEFAULT_MAX_TOKENS,
};

export const initialDSL: Workflow = {
  workflow_id: undefined,
  spec_version: "1.4",
  name: "Loading...",
  icon: "🧩",
  description: "",
  version: "0.1",
  nodes: [],
  edges: [],
  default_llm: DEFAULT_LLM_CONFIG,
  template_adapter: "default",
  enable_tracing: true,
  workflow_type: "workflow",
  state: {},
  experiment_id: undefined,
};

export const initialState: State = {
  ...initialDSL,

  hoveredNodeId: undefined,
  socketStatus: "disconnected",
  propertiesExpanded: false,
  triggerValidation: false,
  workflowSelected: false,
  previousWorkflow: undefined,
  openResultsPanelRequest: undefined,
  playgroundOpen: false,
};

export const getWorkflow = (state: State) => {
  // Keep only the keys present on Workflow type
  return {
    workflow_id: state.workflow_id,
    experiment_id: state.experiment_id,
    spec_version: state.spec_version,
    name: state.name,
    icon: state.icon,
    description: state.description,
    version: state.version,
    default_llm: state.default_llm,
    template_adapter: state.template_adapter,
    enable_tracing: state.enable_tracing,
    workflow_type: state.workflow_type,
    nodes: state.nodes,
    edges: state.edges,
    state: state.state,
  };
};

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
              : p,
          ),
        },
      };
    }
    return node;
  });
};

export const updateCodeClassName = (
  parameters: Field[],
  oldName: string,
  newName: string,
) => {
  return parameters.map((p) => {
    if (p.identifier === "code" && typeof p.value === "string") {
      return {
        ...p,
        value: p.value.replace(
          new RegExp(`class ${oldName}\\(`, "g"),
          `class ${newName}(`,
        ),
      };
    }
    return p;
  });
};

const updateInputFields = (parameters: Field[], inputs: Field[]) => {
  const inputIdentifiers = new Set(inputs.map((i) => i.identifier));
  return parameters.map((p) => {
    if (p.identifier === "code" && typeof p.value === "string") {
      const codeLines = p.value.split("\n");
      const inputClassStartIndex = codeLines.findIndex(
        (line) =>
          line.trim().startsWith("class Input") &&
          line.trim().includes("BaseModel"),
      );

      if (inputClassStartIndex === -1) {
        return p;
      }

      // Find the end of the class definition
      let inputClassEndIndex = inputClassStartIndex + 1;
      while (inputClassEndIndex < codeLines.length) {
        const line = codeLines[inputClassEndIndex];
        // Check if we've reached the next class or end of indentation
        if (
          line !== undefined &&
          line.trim() !== "" &&
          !line.startsWith("    ") &&
          !line.startsWith("\t")
        ) {
          break;
        }
        inputClassEndIndex++;
      }

      // Filter out only fields that are no longer in inputs
      const filteredClassContent = codeLines
        .slice(inputClassStartIndex + 1, inputClassEndIndex)
        .filter((line) => {
          // Keep empty lines and non-field lines
          if (
            line.trim() === "" ||
            !line.includes(":") ||
            line.trim().startsWith("#")
          ) {
            return true;
          }
          // Check if the field identifier is still in inputs
          const fieldIdentifier = line.trim().split(":")[0]?.trim();
          return fieldIdentifier && inputIdentifiers.has(fieldIdentifier);
        });

      // Add new fields that don't exist
      const existingFields = new Set(
        filteredClassContent
          .filter(
            (line) =>
              line.includes(":") &&
              line.trim() !== "" &&
              !line.trim().startsWith("#"),
          )
          .map((line) => line.trim().split(":")[0]?.trim()),
      );

      const newFieldLines = inputs
        .filter((input) => !existingFields.has(input.identifier))
        .map(
          (input) => `    ${input.identifier}: ${input.type === "str" ? "str" : "Any"}`,
        );

      const newCode = [
        ...codeLines.slice(0, inputClassStartIndex + 1),
        ...filteredClassContent,
        ...newFieldLines,
        ...codeLines.slice(inputClassEndIndex),
      ].join("\n");

      return { ...p, value: newCode };
    }
    return p;
  });
};

const updateOutputFields = (
  parameters: Field[],
  existingOutputs: Field[],
  newOutputs: Field[],
) => {
  const oldOutputIdentifiers = new Set(existingOutputs.map((o) => o.identifier));
  const newOutputIdentifiers = new Set(newOutputs.map((o) => o.identifier));

  const addedOutputs = newOutputs.filter(
    (o) => !oldOutputIdentifiers.has(o.identifier),
  );
  const removedOutputs = existingOutputs.filter(
    (o) => !newOutputIdentifiers.has(o.identifier),
  );
  const renamedOutputs = addedOutputs.filter((added) =>
    removedOutputs.some((removed) => removed.type === added.type),
  );

  return parameters.map((p) => {
    if (p.identifier === "code" && typeof p.value === "string") {
      let code = p.value;

      // Handle renames
      for (const added of renamedOutputs) {
        const removed = removedOutputs.find((r) => r.type === added.type);
        if (removed) {
          // Replace in Output class definition
          code = code.replace(
            new RegExp(`${removed.identifier}:`, "g"),
            `${added.identifier}:`,
          );
          // Replace in return statement
          code = code.replace(
            new RegExp(`"${removed.identifier}"`, "g"),
            `"${added.identifier}"`,
          );
        }
      }

      return { ...p, value: code };
    }
    return p;
  });
};

export const store = (
  set: (
    partial:
      | WorkflowStore
      | Partial<WorkflowStore>
      | ((state: WorkflowStore) => WorkflowStore | Partial<WorkflowStore>),
    replace?: boolean | undefined,
  ) => void,
  get: () => WorkflowStore,
): WorkflowStore => ({
  ...initialState,
  reset() {
    set(initialState);
  },
  getWorkflow: () => {
    const state = get();
    return getWorkflow(state);
  },
  getPreviousWorkflow: () => {
    return get().previousWorkflow;
  },
  hasPendingChanges: () => {
    const previousWorkflow = get().previousWorkflow;
    const currentWorkflow = get().getWorkflow();
    if (!previousWorkflow || !currentWorkflow) {
      return false;
    }
    return hasDSLChanged(previousWorkflow, currentWorkflow, true);
  },
  setWorkflow: (
    workflow: Partial<Workflow> | ((current: Workflow) => Partial<Workflow>),
  ) => {
    set(workflow);
  },
  setPreviousWorkflow: (workflow: Workflow | undefined) => {
    set({ previousWorkflow: workflow });
  },
  setSocketStatus: (
    status: SocketStatus | ((status: SocketStatus) => SocketStatus),
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
    const currentEdges = get().edges;
    const existingConnection = currentEdges.find(
      (edge) =>
        edge.target === connection.target &&
        edge.targetHandle === connection.targetHandle,
    );
    if (existingConnection) {
      return {
        error: "Cannot connect two values to the same input",
      };
    }
    set({
      edges: addEdge(connection, currentEdges).map((edge) => ({
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
  edgeConnectToNewHandle: (
    source: string,
    sourceHandle: string,
    target: string,
  ) => {
    const nodes = get().nodes;
    const edges = get().edges;
    const inputs = edges
      .filter((edge) => edge.target === target)
      ?.map((edge) => edge.targetHandle?.split(".")[1]);

    let inc = 2;
    let newHandle = nameToId(sourceHandle);
    while (inputs?.includes(newHandle)) {
      newHandle = `${nameToId(sourceHandle)}${inc}`;
      inc++;
    }

    const sourceField = nodes
      .find((node) => node.id === source)
      ?.data.outputs?.find((output) => output.identifier === sourceHandle);
    let type = sourceField?.type;
    if (type === "json_schema") {
      type = "dict";
    }
    if (!type || !(type in LlmConfigInputTypes)) {
      type = "str";
    }

    const existingInputs = nodes
      .find((node) => node.id === target)
      ?.data.inputs?.map((input) => input.identifier);
    set({
      nodes: nodes.map((node) =>
        node.id === target
          ? {
              ...node,
              data: {
                ...node.data,
                inputs: existingInputs?.includes(newHandle)
                  ? node.data.inputs
                  : [
                      ...(node.data.inputs ?? []),
                      { identifier: newHandle, type },
                    ],
              } as Component,
            }
          : node,
      ),
      edges: [
        ...edges,
        {
          id: `edge-${nanoid()}`,
          source,
          target,
          sourceHandle: `outputs.${sourceHandle}`,
          targetHandle: `inputs.${newHandle}`,
          type: "default",
        },
      ],
    });

    return newHandle;
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
                          newId,
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
                            (node.data?.inputs ?? []) as Field[],
                          ),
                          n.data.outputs ?? [],
                          (node.data?.outputs ?? []) as Field[],
                        ),
                      }
                    : {}),
                },
                id: newId ? newId : n.id,
              }
            : n,
        ),
        edges: get().edges,
      }),
    );
  },
  setNodeParameter: (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: any;
    },
  ) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        const existingParameter = node.data.parameters?.find(
          (p) => p.identifier === parameter.identifier,
        );

        return {
          ...node,
          data: {
            ...node.data,
            parameters: existingParameter
              ? (node.data.parameters ?? []).map((p) =>
                  p.identifier === parameter.identifier
                    ? { ...p, ...parameter }
                    : p,
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
          get().nodes.filter((node) => node.id !== id),
        ),
        edges: get().edges,
      }),
    );
  },
  duplicateNode: (id: string) => {
    const currentNode = get().nodes.find((node) => node.id === id);
    if (!currentNode) {
      return;
    }

    const { name: newName, id: newId } = findLowestAvailableName(
      get().nodes.map((node) => node.id),
      currentNode.data.name?.replace(/ \(.*?\)$/, "") ?? "Component",
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
    executionState: BaseComponent["execution_state"],
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
                  ? { error: executionState.error.slice(0, 2048) }
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
    executionState: Partial<Workflow["state"]["execution"]>,
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
    evaluationState: Partial<Workflow["state"]["evaluation"]>,
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
    optimizationState: Partial<Workflow["state"]["optimization"]>,
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
        node.id === nodeId ? { ...node, selected: true } : node,
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
  stopWorkflowIfRunning: (message: string | undefined) => {
    get().setWorkflowExecutionState({
      status: "error",
      error: message,
      timestamps: { finished_at: Date.now() },
    });
    for (const node of get().nodes) {
      if (node.data.execution_state?.status === "running") {
        get().setComponentExecutionState(node.id, {
          status: "error",
          error: message,
          timestamps: { finished_at: Date.now() },
        });
      }
    }
  },
  checkIfUnreachableErrorMessage: (message: string | undefined) => {
    if (
      get().socketStatus === "connected" &&
      message?.toLowerCase().includes("runtime is unreachable")
    ) {
      get().setSocketStatus("connecting-python");
    }
  },
});

