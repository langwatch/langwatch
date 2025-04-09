import { type Edge, type Node } from "@xyflow/react";
import { z } from "zod";
import { create } from "zustand";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import {
  initialState as initialWorkflowStore,
  type WorkflowStore,
  store as workflowStore,
  type State as WorkflowStoreState,
} from "../../../../../optimization_studio/hooks/useWorkflowStore";
import { entryNode } from "../../../../../optimization_studio/templates/blank";
import type {
  BaseComponent,
  Component,
  Evaluator,
  Field,
  Signature,
  Workflow,
} from "../../../../../optimization_studio/types/dsl";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { datasetColumnsToFields } from "../../../../../optimization_studio/utils/datasetUtils";
import { nameToId } from "../../../../../optimization_studio/utils/nodeUtils";
import { buildEvaluatorFromType } from "../../../../../optimization_studio/utils/registryUtils";
import type { DatasetColumns } from "../../../../../server/datasets/types";
import { mappingStateSchema } from "../../../../../server/tracer/tracesMapping";
import { checkPreconditionsSchema } from "../../../../../server/evaluations/types.generated";
import { DEFAULT_SIGNATURE_NODE_PROPERTIES } from "../constants/llm-signature";
import {
  createFieldMappingEdges,
  connectEvaluatorFields,
} from "../../../utils/field-mapping";

export const EVALUATOR_CATEGORIES = [
  "expected_answer",
  "llm_judge",
  "quality",
  "rag",
  "safety",
] as const;

export type EvaluatorCategory = (typeof EVALUATOR_CATEGORIES)[number];

export const STEPS = [
  "task",
  "dataset",
  "execution",
  "evaluation",
  "results",
] as const;

export type Step = (typeof STEPS)[number];

export type PartialEdge = Omit<Workflow["edges"][number], "target"> & {
  target?: string;
};

export const TASK_TYPES = {
  real_time: "Set up real-time evaluation",
  llm_app: "Offline evaluation",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Evaluate your Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export type TaskType = keyof typeof TASK_TYPES;

export const DATA_SOURCE_TYPES = {
  choose: "Choose existing dataset",
  from_production: "Import from Production",
  manual: "Create manually",
  upload: "Upload CSV",
} as const;

export const OFFLINE_EXECUTION_METHODS = {
  offline_prompt: "Create a prompt",
  offline_http: "Call an HTTP endpoint",
  offline_workflow: "Create a Workflow",
  offline_notebook: "Run on Notebook or CI/CD Pipeline",
  offline_code_execution: "Run code",
} as const;

export type OfflineExecutionMethod = keyof typeof OFFLINE_EXECUTION_METHODS;

export const EXECUTION_METHODS = {
  realtime_on_message: "When a message arrives",
  realtime_guardrail: "As a guardrail",
  realtime_manually: "Manually",

  ...OFFLINE_EXECUTION_METHODS,
  api: "Run on Notebook or CI/CD Pipeline",
} as const;

export const wizardStateSchema = z.object({
  name: z.string().optional(),
  step: z.enum(STEPS),
  task: z.enum(Object.keys(TASK_TYPES) as [keyof typeof TASK_TYPES]).optional(),
  dataSource: z
    .enum(Object.keys(DATA_SOURCE_TYPES) as [keyof typeof DATA_SOURCE_TYPES])
    .optional(),
  executionMethod: z
    .enum(Object.keys(EXECUTION_METHODS) as [keyof typeof EXECUTION_METHODS])
    .optional(),
  evaluatorCategory: z.enum(EVALUATOR_CATEGORIES).optional(),
  realTimeTraceMappings: mappingStateSchema.optional(),
  realTimeExecution: z
    .object({
      sample: z.number().min(0).max(1).optional(),
      preconditions: checkPreconditionsSchema.optional(),
    })
    .optional(),
  workspaceTab: z
    .enum(["dataset", "workflow", "results", "code-implementation"])
    .optional(),
});

export type WizardState = z.infer<typeof wizardStateSchema>;

export type State = {
  experimentId?: string;
  experimentSlug?: string;
  wizardState: z.infer<typeof wizardStateSchema>;
  isAutosaving: boolean;
  autosaveDisabled: boolean;
  workflowStore: WorkflowStoreState;
};

type EvaluationWizardStore = State & {
  reset: () => void;
  setExperimentId: (experimentId: string) => void;
  setExperimentSlug: (experimentSlug: string) => void;
  setWizardState: (
    state:
      | Partial<State["wizardState"]>
      | ((state: State["wizardState"]) => Partial<State["wizardState"]>)
  ) => void;
  getWizardState: () => State["wizardState"];
  setDSL: (
    dsl:
      | Partial<Workflow & { workflowId?: string }>
      | ((
          state: Workflow & { workflowId?: string }
        ) => Partial<Workflow & { workflowId?: string }>)
  ) => void;
  getDSL: () => Workflow & { workflowId?: string };
  setIsAutosaving: (isAutosaving: boolean) => void;
  skipNextAutosave: () => void;
  nextStep: () => void;
  previousStep: () => void;
  setDatasetId: (datasetId: string, columnTypes: DatasetColumns) => void;
  getDatasetId: () => string | undefined;
  setFirstEvaluator: (
    evaluator: Partial<Evaluator> & { evaluator: EvaluatorTypes }
  ) => void;
  getFirstEvaluatorNode: () => Node<Evaluator> | undefined;
  setFirstEvaluatorEdges: (edges: Workflow["edges"]) => void;
  getFirstEvaluatorEdges: () => Workflow["edges"] | undefined;

  // Signature Node Management
  getSignatureNodes: () => Node<Signature>[];
  addSignatureNode: (node?: Omit<Partial<Node<Signature>>, "type">) => void;
  updateSignatureNode: (nodeId: string, node: Partial<Node<Signature>>) => void;
  updateSignatureNodeLLMConfigValue: (
    nodeId: string,
    llmConfig: LLMConfig
  ) => void;

  // Generic node management
  updateNode: <T extends BaseComponent>(
    nodeId: string,
    updateProperties: Partial<Node<T>>
  ) => void;

  workflowStore: WorkflowStore;
} & {
  // Properties and methods from the workflow store
  setNodeParameter: WorkflowStore["setNodeParameter"];
};

export const initialState: State = {
  experimentSlug: undefined,
  wizardState: {
    step: "task",
    workspaceTab: "dataset",
  },
  isAutosaving: false,
  autosaveDisabled: false,
  workflowStore: initialWorkflowStore,
};

const store = (
  set: (
    partial:
      | EvaluationWizardStore
      | Partial<EvaluationWizardStore>
      | ((
          state: EvaluationWizardStore
        ) => EvaluationWizardStore | Partial<EvaluationWizardStore>),
    replace?: boolean | undefined
  ) => void,
  get: () => EvaluationWizardStore
): EvaluationWizardStore => {
  const addNode = (node: Node<BaseComponent>) => {
    get().workflowStore.setWorkflow((current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));
  };

  const addEdge = (edge: Edge) => {
    get().workflowStore.setWorkflow((current) => ({
      ...current,
      edges: [...current.edges, edge],
    }));
  };

  const findNodeByType = (type: string) => {
    return get()
      .workflowStore.getWorkflow()
      .nodes.find((node) => node.type === type);
  };

  const getNodes = ({ type }: { type?: string }) => {
    return get()
      .workflowStore.getWorkflow()
      .nodes.filter((node) => !type || node.type === type);
  };

  const store: EvaluationWizardStore = {
    ...initialState,
    reset() {
      set((current) => ({
        ...current,
        ...initialState,
        workflowStore: createWorkflowStore(set, get),
      }));
    },
    setExperimentId(experimentId) {
      set((current) => ({ ...current, experimentId }));
    },
    setExperimentSlug(experimentSlug) {
      set((current) => ({ ...current, experimentSlug }));
    },
    setWizardState(state) {
      const applyChanges = (
        current: EvaluationWizardStore,
        next: Partial<State["wizardState"]>
      ) => {
        return {
          ...current,
          wizardState: {
            ...current.wizardState,
            ...next,
            ...(next.step === "dataset"
              ? { workspaceTab: "dataset" as const }
              : {}),
          },
        };
      };

      if (typeof state === "function") {
        set((current) => applyChanges(current, state(current.wizardState)));
      } else {
        set((current) => applyChanges(current, state));
      }
    },
    getWizardState() {
      return get().wizardState;
    },
    setDSL(dsl) {
      get().workflowStore.setWorkflow(dsl);
    },
    getDSL() {
      return get().workflowStore.getWorkflow();
    },
    setIsAutosaving(isAutosaving) {
      set((current) => ({ ...current, isAutosaving }));
    },
    skipNextAutosave() {
      set((current) => ({ ...current, autosaveDisabled: true }));
      setTimeout(() => {
        set((current) => ({ ...current, autosaveDisabled: false }));
      }, 100);
    },
    nextStep() {
      set((current) => {
        const currentStepIndex = STEPS.indexOf(current.wizardState.step);
        if (currentStepIndex < STEPS.length - 1) {
          const nextStep = STEPS[currentStepIndex + 1];
          return {
            ...current,
            wizardState: { ...current.wizardState, step: nextStep! },
          };
        }
        return current;
      });
    },
    previousStep() {
      set((current) => {
        const currentStepIndex = STEPS.indexOf(current.wizardState.step);
        if (currentStepIndex > 0) {
          const previousStep = STEPS[currentStepIndex - 1];
          return {
            ...current,
            wizardState: { ...current.wizardState, step: previousStep! },
          };
        }
        return current;
      });
    },
    setDatasetId(datasetId, columnTypes) {
      get().workflowStore.setWorkflow((current) => {
        const hasEntryNode = current.nodes.some(
          (node) => node.type === "entry"
        );

        if (hasEntryNode) {
          return {
            ...current,
            nodes: current.nodes.map((node) => {
              if (node.type !== "entry") {
                return node;
              }

              return {
                ...node,
                data: {
                  ...node.data,
                  dataset: { id: datasetId },
                  outputs: datasetColumnsToFields(columnTypes),
                },
              };
            }),
          };
        } else {
          const newEntryNode = entryNode();

          return {
            ...current,
            nodes: [
              ...current.nodes,
              {
                ...newEntryNode,
                data: {
                  ...newEntryNode.data,
                  dataset: { id: datasetId },
                  outputs: datasetColumnsToFields(columnTypes),
                },
              },
            ],
          };
        }
      });
    },
    getDatasetId() {
      const entryNodeData = get()
        .workflowStore.getWorkflow()
        .nodes.find((node) => node.type === "entry")?.data;
      if (entryNodeData && "dataset" in entryNodeData) {
        return entryNodeData.dataset?.id;
      }
      return undefined;
    },
    /**
     * Creates or updates the first evaluator node in the workflow.
     *
     * If no evaluator node exists, it creates a new one with the specified evaluator type.
     * If an evaluator node already exists, it updates it with the new properties while
     * preserving existing parameters unless the evaluator type has changed.
     *
     * When the evaluator type changes, it:
     * 1. Resets the parameters to default values
     * 2. Maintains the node's position in the workflow
     * 3. Preserves the node's ID based on the evaluator name/class
     *
     * This method is used by the evaluator selection and settings components to
     * configure the evaluation workflow.
     *
     * ---
     *
     * TODO: Consider simply replacing any existing evaluators when this is called,
     * rather than trying to handle a complex merge.
     */
    setFirstEvaluator(
      evaluator: Partial<Evaluator> & { evaluator: EvaluatorTypes }
    ) {
      get().workflowStore.setWorkflow((current) => {
        // Validate evaluator type
        if (evaluator.evaluator.startsWith("custom/")) {
          throw new Error("Custom evaluators are not supported yet");
        }

        // Find existing evaluator node if any
        const firstEvaluatorIndex = current.nodes.findIndex(
          (node) => node.type === "evaluator"
        );
        const previousEvaluator =
          firstEvaluatorIndex !== -1
            ? (current.nodes[firstEvaluatorIndex] as Node<Evaluator>)
            : undefined;

        // Get base evaluator properties from the evaluator type
        const initialEvaluator = buildEvaluatorFromType(evaluator.evaluator);
        const id = nameToId(initialEvaluator.name ?? initialEvaluator.cls);

        // Check if evaluator type has changed
        const hasEvaluatorChanged =
          previousEvaluator?.data.evaluator !== evaluator.evaluator;

        // Determine base node to use (create new or use existing)
        const baseEvaluatorNode =
          hasEvaluatorChanged || !previousEvaluator
            ? {
                id,
                type: "evaluator",
                data: initialEvaluator,
                position: { x: 600, y: 0 },
              }
            : previousEvaluator;

        // Create the final evaluator node with merged properties
        const evaluatorNode: Node<Evaluator> = {
          ...baseEvaluatorNode,
          id,
          data: {
            ...baseEvaluatorNode.data,
            ...evaluator,
            // Preserve metadata from initial evaluator
            name: initialEvaluator.name,
            description: initialEvaluator.description,
            // Handle parameters:
            // 1. Use provided parameters if available
            // 2. Reset parameters if evaluator type changed
            // 3. Otherwise keep existing parameters
            parameters:
              evaluator.data?.parameters ??
              (hasEvaluatorChanged
                ? []
                : baseEvaluatorNode.data.parameters ?? []),
          },
        };

        const newEdges = createNewEdgesForNewNode(current, evaluatorNode);

        // If the first evaluator node is not found,
        // simply add the new evaluator node and new edges
        if (firstEvaluatorIndex === -1) {
          return {
            ...current,
            nodes: [...current.nodes, evaluatorNode],
            edges: [...current.edges, ...newEdges],
          };
        }

        // Otherwise, update the existing evaluator and handle edges
        return {
          ...current,
          // Replace the existing evaluator node
          nodes: current.nodes.map((node, index) =>
            index === firstEvaluatorIndex ? evaluatorNode : node
          ),
          // Remove old edges targeting the evaluator and add new connections
          edges: [
            ...current.edges.filter((edge) => edge.target !== evaluatorNode.id),
            ...newEdges,
          ],
        };
      });
    },
    getFirstEvaluatorNode() {
      const node = get()
        .workflowStore.getWorkflow()
        .nodes.find((node) => node.type === "evaluator");
      if (node?.data && "evaluator" in node.data) {
        return node as Node<Evaluator>;
      }
      return undefined;
    },
    /**
     * Updates the edges by removing those that target the previous evaluator
     * and adding the new edges provided. It also updates the target of the
     * provided edges to point to the new evaluator.
     *
     * If no evaluator node is found, the current workflow is returned.
     */
    setFirstEvaluatorEdges(edges: Edge[]) {
      get().workflowStore.setWorkflow((current) => {
        const firstEvaluator = get().getFirstEvaluatorNode();

        // If no evaluator node is found, return the current workflow
        if (!firstEvaluator?.id) {
          return current;
        }

        return {
          ...current,
          edges: [
            ...current.edges.filter(
              (edge) => edge.target !== firstEvaluator.id
            ),
            ...edges.map((edge) => ({
              ...edge,
              target: firstEvaluator.id,
            })),
          ],
        };
      });
    },
    getFirstEvaluatorEdges() {
      const firstEvaluator = get().getFirstEvaluatorNode();
      if (!firstEvaluator) {
        return undefined;
      }

      return get()
        .workflowStore.getWorkflow()
        .edges.filter((edge) => edge.target === firstEvaluator.id);
    },
    getSignatureNodes() {
      return getNodes({ type: "signature" });
    },

    /**
     * Add a signature node to the workflow
     *
     * If no node is provide, assumes it is the first llm added
     * and will use defaults
     */
    addSignatureNode(node?: Omit<Partial<Node<Signature>>, "type">) {
      // Calculate node position based on the last node or use default position
      const nodePosition =
        node?.position ??
        calcNextNodePositionFromCurrentNodes(
          get().workflowStore.getWorkflow().nodes
        );

      const signatureNode = {
        ...DEFAULT_SIGNATURE_NODE_PROPERTIES,
        position: nodePosition,
        ...node,
      };

      addNode(signatureNode);

      // Find the entry node for the dataset
      const entryNode = findNodeByType("entry");

      // Handle the case where the entry node is not found
      if (!entryNode) {
        // We should handle this better
        console.warn(
          "Entry node not found. Unable to connect to signature node."
        );

        return;
      }

      const edges = createNewEdgesForNewNode(
        get().workflowStore.getWorkflow(),
        signatureNode
      );

      // Add edges connecting entry node input to signature node input
      edges.forEach((edge) => {
        addEdge(edge);
      });
    },

    updateSignatureNodeLLMConfigValue(nodeId: string, llmConfig: LLMConfig) {
      get().workflowStore.setWorkflow((current) => {
        return updateNode(current, nodeId, (node) =>
          updateNodeParameter(node, {
            identifier: "llm",
            type: "llm",
            value: llmConfig,
          })
        );
      });
    },
    // Generic node update function
    updateNode(nodeId, updateProperties) {
      get().workflowStore.setWorkflow((current) => {
        return updateNode(current, nodeId, (node) => ({
          ...node,
          ...updateProperties,
        }));
      });
    },
    // Generic node parameter update function
    setNodeParameter(
      nodeId: string,
      parameter: Partial<Omit<Field, "value">> & {
        identifier: string;
        type: Field["type"];
        value?: unknown;
      }
    ) {
      get().workflowStore.setWorkflow((current) => {
        return updateNode(current, nodeId, (node) =>
          updateNodeParameter(node, parameter)
        );
      });
    },
    workflowStore: createWorkflowStore(set, get),
  };

  return store;
};

const createWorkflowStore = (
  set: (
    partial:
      | EvaluationWizardStore
      | Partial<EvaluationWizardStore>
      | ((
          state: EvaluationWizardStore
        ) => EvaluationWizardStore | Partial<EvaluationWizardStore>),
    replace?: boolean | undefined
  ) => void,
  get: () => EvaluationWizardStore
) => {
  return workflowStore(
    (partial: WorkflowStore | ((state: WorkflowStore) => WorkflowStore)) =>
      set((current) => ({
        ...current,
        workflowStore:
          typeof partial === "function"
            ? { ...current.workflowStore, ...partial(current.workflowStore) }
            : { ...current.workflowStore, ...partial },
      })),
    () => get().workflowStore
  );
};

export const useEvaluationWizardStore = create<EvaluationWizardStore>()(store);

// Helper functions

const calcNextNodePositionFromCurrentNodes = (
  currentNodes: Node<BaseComponent>[]
) => {
  const lastNode = currentNodes[currentNodes.length - 1];
  if (lastNode) {
    return {
      x: lastNode.position.x + (lastNode.width ?? 0) + 200,
      y: lastNode.position.y,
    };
  }
  return { x: 0, y: 0 };
};

type NodeUpdater<C extends Component> = (node: Node<C>) => Node<C>;

/**
 * Generic node update function
 * Will update the node with the updater function
 */
function updateNode(
  workflow: Workflow,
  nodeId: string,
  updater: NodeUpdater<Component>
): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.id === nodeId ? updater(node) : node
    ),
  };
}

/**
 * TODO: Reconsider this approach
 * Generic parameter update function
 * Will add the parameter if it doesn't exist and update the value if it does
 */
function updateNodeParameter(
  node: Node<Component>,
  parameter: Partial<Omit<Field, "value">> & {
    identifier: string;
    type: Field["type"];
    value?: any;
  }
): Node<Component> {
  const parameters = node.data.parameters ?? [];
  const paramIndex = parameters.findIndex(
    (p) => p.identifier === parameter.identifier
  );

  const updatedParameters =
    paramIndex === -1
      ? [...parameters, parameter]
      : parameters.map((param, index) =>
          index === paramIndex ? { ...param, ...parameter } : param
        );

  return {
    ...node,
    data: {
      ...node.data,
      parameters: updatedParameters,
    },
  };
}

/**
 * Create new edges for new node using our field mapping utility.
 * This is more comprehensive than the previous implementation and handles all
 * fields, not just input and output.
 */
function createNewEdgesForNewNode(
  workflow: Workflow,
  node: Node<Component>
): Edge[] {
  // Use specialized function for evaluator nodes
  if (node.type === "evaluator") {
    return connectEvaluatorFields(workflow, node as Node<Evaluator>);
  }

  // Use general field mapping for other node types
  return createFieldMappingEdges(workflow, node);
}
