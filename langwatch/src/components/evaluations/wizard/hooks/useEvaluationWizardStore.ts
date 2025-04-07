import { type Edge, type Node } from "@xyflow/react";
import { z } from "zod";
import { create } from "zustand";
import type { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import {
  initialState as initialWorkflowStore,
  type WorkflowStore,
  store as workflowStore,
  type State as WorkflowStoreState,
} from "../../../../optimization_studio/hooks/useWorkflowStore";
import { entryNode } from "../../../../optimization_studio/templates/blank";
import type {
  BaseComponent,
  Component,
  Evaluator,
  Field,
  Signature,
  Workflow,
} from "../../../../optimization_studio/types/dsl";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { datasetColumnsToFields } from "../../../../optimization_studio/utils/datasetUtils";
import { nameToId } from "../../../../optimization_studio/utils/nodeUtils";
import { convertEvaluator } from "../../../../optimization_studio/utils/registryUtils";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { mappingStateSchema } from "../../../../server/tracer/tracesMapping";
import { checkPreconditionsSchema } from "../../../../server/evaluations/types.generated";
import { MODULES } from "~/optimization_studio/registry";

const DEFAULT_LLM_CONFIG = {
  model: "gpt-4o-mini",
};

const DEFAULT_SIGNATURE_NODE_PROPERTIES = {
  id: "signature-node",
  position: { x: 0, y: 0 },
  deletable: true,
  data: {
    // Default signature data
    ...MODULES.signature,
    parameters: [
      ...(MODULES.signature.parameters ?? []).map((p) =>
        // Set the default LLM config
        p.identifier === "llm"
          ? {
              ...p,
              value: DEFAULT_LLM_CONFIG,
            }
          : p
      ),
    ],
    inputs: [
      {
        identifier: "input",
        type: "str" as const,
      },
    ],
    outputs: [
      {
        identifier: "output",
        type: "str" as const,
      },
    ],
  },
  type: "signature",
};

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
    evaluator: Partial<Evaluator> & { evaluator: string }
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
        console.log("applyChanges", next);
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
    setFirstEvaluator(evaluator: Partial<Evaluator> & { evaluator: string }) {
      get().workflowStore.setWorkflow((current) => {
        if (evaluator.evaluator.startsWith("custom/")) {
          throw new Error("Custom evaluators are not supported yet");
        }

        const firstEvaluatorIndex = current.nodes.findIndex(
          (node) => node.type === "evaluator"
        );

        const initialEvaluator = convertEvaluator(
          evaluator.evaluator as keyof typeof AVAILABLE_EVALUATORS
        );
        const id = nameToId(initialEvaluator.name ?? initialEvaluator.cls);

        const previousEvaluator = current.nodes[firstEvaluatorIndex] as
          | Node<Evaluator>
          | undefined;
        const hasEvaluatorChanged =
          previousEvaluator?.data.evaluator !== evaluator.evaluator;
        const firstEvaluator =
          hasEvaluatorChanged || !previousEvaluator
            ? {
                id,
                type: "evaluator",
                data: initialEvaluator,
                position: { x: 600, y: 0 },
              }
            : previousEvaluator;

        const evaluatorNode: Node<Evaluator> = {
          ...firstEvaluator,
          id,
          data: {
            ...firstEvaluator.data,
            ...evaluator,
            name: initialEvaluator.name,
            description: initialEvaluator.description,
            parameters:
              evaluator.data?.parameters ??
              // Reset parameters if not given the evaluator is not the same as the current evaluator
              (firstEvaluator.data.evaluator !== evaluator.evaluator
                ? []
                : firstEvaluator.data.parameters ?? []),
          },
        };

        if (firstEvaluatorIndex === -1) {
          return {
            ...current,
            nodes: [...current.nodes, evaluatorNode],
          };
        }

        // Update the state with the new evaluator node and remove the old edges
        return {
          ...current,
          nodes: current.nodes.map((node, index) =>
            index === firstEvaluatorIndex ? evaluatorNode : node
          ),
          edges: current.edges.filter(
            (edge) =>
              edge.target !== previousEvaluator?.id || !hasEvaluatorChanged
          ),
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
    setFirstEvaluatorEdges(edges: Edge[]) {
      get().workflowStore.setWorkflow((current) => {
        const firstEvaluator = get().getFirstEvaluatorNode();

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

      // Add edge connecting entry node input to signature node input
      addEdge({
        id: `${entryNode.id}-to-${signatureNode.id}`,
        source: entryNode.id,
        sourceHandle: "outputs.input",
        target: signatureNode.id,
        targetHandle: "inputs.input",
      });
    },

    updateSignatureNode(
      nodeId: string,
      updateProperties: Partial<Node<Signature>>
    ) {
      get().workflowStore.setWorkflow((current) => {
        return updateNode(current, nodeId, (node) => ({
          ...node,
          ...updateProperties,
        }));
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
    (
      partial:
        | WorkflowStore
        | Partial<WorkflowStore>
        | ((state: WorkflowStore) => WorkflowStore | Partial<WorkflowStore>)
    ) =>
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
