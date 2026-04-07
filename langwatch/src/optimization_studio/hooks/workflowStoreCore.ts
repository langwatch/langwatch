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
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "~/utils/logger";
import { LlmConfigInputTypes } from "../../types";
import { snakeCaseToPascalCase } from "../../utils/stringCasing";
import type {
  BaseComponent,
  Component,
  Field,
  LLMConfig,
  Workflow,
} from "../types/dsl";
import { hasDSLChanged } from "../utils/dslUtils";
import { findLowestAvailableName, nameToId } from "../utils/nodeUtils";

const logger = createLogger("langwatch:studio:workflowStore");

export type SocketStatus = "disconnected" | "connecting-python" | "connected";

export type State = Workflow & {
  workflow_id?: string;
  hoveredNodeId?: string;
  socketStatus: SocketStatus;
  propertiesExpanded: boolean;
  triggerValidation: boolean;
  workflowSelected: boolean;
  /** The workflow state as of the last autosave. Used as the baseline for hasPendingChanges(). */
  autosavedWorkflow: Workflow | undefined;
  /** The workflow state as of the last manual commit (or version restore/load). Used as the baseline for checkCanCommitNewVersion(). */
  lastCommittedWorkflow: Workflow | undefined;
  /** The DB id of the current workflow version. Updated on load, autosave, commit, and restore. */
  currentVersionId: string | undefined;
  openResultsPanelRequest:
    | "evaluations"
    | "optimizations"
    | "closed"
    | undefined;
  playgroundOpen: boolean;
  /** True while the user is dragging a node. Used to suppress drawer opening during drag. */
  isDraggingNode: boolean;
  /** The node ID confirmed by onNodeClick (genuine click, not drag). Gates drawer opening. */
  clickedNodeId: string | null;
};

export type WorkflowStore = State & {
  reset: () => void;
  getWorkflow: () => Workflow;
  getAutosavedWorkflow: () => Workflow | undefined;
  hasPendingChanges: () => boolean;
  setWorkflow: (
    workflow:
      | (Partial<Workflow> & { workflow_id?: string })
      | ((current: Workflow) => Partial<Workflow> & { workflow_id?: string }),
  ) => void;
  /** Update the autosave baseline. Called after each autosave completes. */
  setAutosavedWorkflow: (workflow: Workflow | undefined) => void;
  /** Update the committed baseline. Called on load, manual commit, and version restore. */
  setLastCommittedWorkflow: (workflow: Workflow | undefined) => void;
  /** Update the current version ID. Called on load, autosave, manual commit, and version restore. */
  setCurrentVersionId: (id: string | undefined) => void;
  /** Returns true if the current workflow differs from the last committed version. Synchronous — no DB query needed. */
  checkCanCommitNewVersion: () => boolean;
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
  setIsDraggingNode: (dragging: boolean) => void;
  setClickedNodeId: (id: string | null) => void;
  stopWorkflowIfRunning: (message: string | undefined) => void;
  checkIfUnreachableErrorMessage: (message: string | undefined) => void;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  model: DEFAULT_MODEL,
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
  autosavedWorkflow: undefined,
  lastCommittedWorkflow: undefined,
  currentVersionId: undefined,
  openResultsPanelRequest: undefined,
  playgroundOpen: false,
  isDraggingNode: false,
  clickedNodeId: null,
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
    nodes: state.nodes,
    edges: state.edges,
    state: state.state,
    workflow_type: state.workflow_type,
  };
};

/**
 * Strips transient UI state (selected, dragging, execution_state) from the
 * workflow before serialization (autosave, execution payloads). This prevents
 * UI-only state from being persisted to the database.
 */
export const serializeWorkflow = <T extends { nodes: Node[]; edges: Edge[] }>(
  workflow: T,
): T => {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const { selected, dragging, ...rest } = node;
      const { execution_state, ...dataRest } = rest.data as Record<string, unknown>;
      return { ...rest, data: dataRest };
    }) as T["nodes"],
    edges: workflow.edges.map((edge) => {
      const { selected, ...rest } = edge;
      return rest;
    }) as T["edges"],
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

      const target = nodes.find((node) => node.id === edge.target);
      const [targetHandleGroup, targetHandleIdentifier] =
        edge.targetHandle?.split(".") ?? [null, null];

      if (!source || !target) {
        logger.warn(
          {
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            reason: !source ? "source node not found" : "target node not found",
          },
          "dropping edge: node missing",
        );

        return false;
      }

      const sourceHandles = (source.data as Record<string, unknown>)[
        sourceHandleGroup as string
      ] as Field[] | undefined;
      const targetHandles = (target.data as Record<string, unknown>)[
        targetHandleGroup as string
      ] as Field[] | undefined;

      // If the handle group doesn't exist as an array, preserve the edge
      // (the group hasn't been loaded/set yet). Only drop if the group
      // IS an array but the specific identifier is missing.
      const sourceValid =
        !Array.isArray(sourceHandles) ||
        sourceHandles.some((f) => f.identifier === sourceHandleIdentifier);
      const targetValid =
        !Array.isArray(targetHandles) ||
        targetHandles.some((f) => f.identifier === targetHandleIdentifier);

      if (!sourceValid || !targetValid) {
        logger.warn(
          {
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            reason: !sourceValid
              ? `source handle identifier '${sourceHandleIdentifier}' not found in '${sourceHandleGroup}' array`
              : `target handle identifier '${targetHandleIdentifier}' not found in '${targetHandleGroup}' array`,
          },
          "dropping edge: handle identifier missing",
        );

      }

      return sourceValid && targetValid;
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
  _oldId: string,
  newId: string,
): Field[] => {
  return parameters.map((p) =>
    p.identifier === "code"
      ? {
          ...p,
          value: (p.value as string).replace(
            /class .*?\(dspy\.Module\):/,
            `class ${snakeCaseToPascalCase(newId)}(dspy.Module):`,
          ),
        }
      : p,
  );
};

const typesMap: Record<Field["type"], string> = {
  str: "str",
  int: "int",
  float: "float",
  bool: "bool",
  image: "dspy.Image",
  list: "list",
  "list[str]": "list[str]",
  "list[float]": "list[float]",
  "list[int]": "list[int]",
  "list[bool]": "list[bool]",
  dict: "dict[str, Any]",
  json_schema: "Any",
  chat_messages: "list[dict[str, Any]]",
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
          .join(", ")}):`,
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

const escapeRegex = (str: string) =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const updateOutputFields = (
  parameters: Field[],
  previousOutputs: Field[],
  outputs: Field[],
) => {
  if (previousOutputs.length !== outputs.length) {
    return parameters;
  }

  return parameters.map((p) => {
    if (p.identifier === "code") {
      let code = p.value as string;
      for (const [index, output] of outputs.entries()) {
        const escapedId = escapeRegex(
          previousOutputs[index]?.identifier ?? "",
        );
        code = code.replace(
          new RegExp(
            `(return[\\s\\n\\t]+?\\{[^\\}]*?)"${escapedId}"`,
          ),
          `$1"${output.identifier}"`,
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
  getAutosavedWorkflow: () => {
    return get().autosavedWorkflow;
  },
  hasPendingChanges: () => {
    const autosavedWorkflow = get().autosavedWorkflow;
    const currentWorkflow = get().getWorkflow();
    if (!autosavedWorkflow || !currentWorkflow) {
      return false;
    }
    return hasDSLChanged(autosavedWorkflow, currentWorkflow, true);
  },
  setWorkflow: (
    workflow: Partial<Workflow> | ((current: Workflow) => Partial<Workflow>),
  ) => {
    const resolved =
      typeof workflow === "function" ? workflow(get().getWorkflow()) : workflow;
    const keys = Object.keys(resolved);
    logger.debug({ keys }, "setWorkflow: updating workflow");
    if ("edges" in resolved) {
      const currentEdges = get().edges;
      const newEdges = (resolved as { edges: Edge[] }).edges;
      if (newEdges && newEdges.length < currentEdges.length) {
        logger.warn(
          {
            before: currentEdges.length,
            after: newEdges.length,
            removed: currentEdges
              .filter((e) => !newEdges.some((ne: Edge) => ne.id === e.id))
              .map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
              })),
          },
          "setWorkflow: edges count decreased",
        );

      }
    }
    set(resolved);
  },
  setAutosavedWorkflow: (workflow: Workflow | undefined) => {
    set({ autosavedWorkflow: workflow });
  },
  setLastCommittedWorkflow: (workflow: Workflow | undefined) => {
    set({ lastCommittedWorkflow: workflow });
  },
  setCurrentVersionId: (id: string | undefined) => {
    set({ currentVersionId: id });
  },
  checkCanCommitNewVersion: () => {
    const lastCommitted = get().lastCommittedWorkflow;
    const currentWorkflow = get().getWorkflow();
    if (!lastCommitted || !currentWorkflow) {
      return false;
    }
    return hasDSLChanged(currentWorkflow, lastCommitted, false);
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
    const removeChanges = changes.filter((c) => c.type === "remove");
    if (removeChanges.length > 0) {
      logger.warn(
        { removeChanges },
        "onNodesChange: REMOVING nodes",
      );

    }
    const hasDeselection = changes.some(
      (c) => c.type === "select" && !c.selected,
    );
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      ...(hasDeselection ? { clickedNodeId: null } : {}),
    });
  },
  onNodesDelete: () => {
    set({
      nodes: removeInvalidDecorations(get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    const removeChanges = changes.filter((c) => c.type === "remove");
    if (removeChanges.length > 0) {
      logger.warn(
        {
          removeChanges,
          totalChanges: changes.length,
        },
        "onEdgesChange: REMOVING edges",
      );

    }
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
    const currentEdges = get().edges;
    if (edges.length < currentEdges.length) {
      logger.warn(
        {
          before: currentEdges.length,
          after: edges.length,
          removed: currentEdges
            .filter((e) => !edges.some((ne) => ne.id === e.id))
            .map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
        },
        "setEdges: edges count decreased",
      );

    }
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
    const oldId = node.id;
    const dataEntries = Object.entries(node.data ?? {});
    logger.debug(
      { nodeId: oldId, newId, dataKeys: dataEntries.map(([k]) => k) },
      "setNode: updating node",
    );
    const updatedNodes = get().nodes.map((n) => {
      if (n.id !== oldId) return n;

      // Only filter out undefined when the existing field is an Array, to
      // prevent accidental overwrites of arrays (e.g., inputs/outputs).
      // Non-array fields allow undefined through so callers can intentionally
      // clear fields like localConfig and localPromptConfig.
      const existingData = n.data as Record<string, unknown>;
      const arrayPreservedKeys = dataEntries
        .filter(([k, v]) => v === undefined && Array.isArray(existingData[k]))
        .map(([k]) => k);
      if (arrayPreservedKeys.length > 0) {
        logger.warn(
          { nodeId: oldId, arrayPreservedKeys },
          "setNode: undefined values filtered to preserve existing arrays",
        );
      }
      const filteredDataEntries = dataEntries.filter(
        ([k, v]) => v !== undefined || !Array.isArray(existingData[k]),
      );

      return {
        ...n,
        ...node,
        data: {
          ...n.data,
          ...Object.fromEntries(filteredDataEntries),
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
      };
    });

    // When renaming, update edges and parameter refs that reference the old ID
    const updatedEdges = newId
      ? get().edges.map((edge) => ({
          ...edge,
          source: edge.source === oldId ? newId : edge.source,
          target: edge.target === oldId ? newId : edge.target,
        }))
      : get().edges;

    const nodesWithUpdatedRefs = newId
      ? updatedNodes.map((n) => {
          if (n.id === newId || !n.data.parameters) return n;
          return {
            ...n,
            data: {
              ...n.data,
              parameters: (n.data.parameters as Field[]).map((p) =>
                (p.value as { ref: string })?.ref === oldId
                  ? { ...p, value: { ref: newId } }
                  : p,
              ),
            },
          };
        })
      : updatedNodes;

    set(
      removeInvalidEdges({
        nodes: nodesWithUpdatedRefs,
        edges: updatedEdges,
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
    logger.info({ nodeId: id }, "deleteNode: deleting node");
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
    logger.debug(
      { componentId: id, status: executionState?.status },
      "setComponentExecutionState: execution state changed",
    );
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
        node.id === nodeId
          ? { ...node, selected: true }
          : node.selected
            ? { ...node, selected: false }
            : node,
      ),
      clickedNodeId: nodeId,
    });
  },
  deselectAllNodes: () => {
    set({
      nodes: get().nodes.map((node) => ({ ...node, selected: false })),
      workflowSelected: false,
      clickedNodeId: null,
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
      set({
        nodes: get().nodes.map((node) => ({ ...node, selected: false })),
        clickedNodeId: null,
      });
    }
  },
  setOpenResultsPanelRequest: (request) => {
    set({ openResultsPanelRequest: request });
  },
  setPlaygroundOpen: (open: boolean) => {
    set({ playgroundOpen: open });
  },
  setIsDraggingNode: (dragging: boolean) => {
    set({
      isDraggingNode: dragging,
      ...(dragging ? { clickedNodeId: null } : {}),
    });
  },
  setClickedNodeId: (id: string | null) => {
    set({ clickedNodeId: id });
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
