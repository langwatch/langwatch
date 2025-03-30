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
  Evaluator,
  Workflow,
} from "../../../../optimization_studio/types/dsl";
import { datasetColumnsToFields } from "../../../../optimization_studio/utils/datasetUtils";
import { nameToId } from "../../../../optimization_studio/utils/nodeUtils";
import { convertEvaluator } from "../../../../optimization_studio/utils/registryUtils";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { mappingStateSchema } from "../../../../server/tracer/tracesMapping";
import { checkPreconditionsSchema } from "../../../../server/evaluations/types.generated";

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
  llm_app: "Evaluate your LLM app",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Create Custom Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export const DATA_SOURCE_TYPES = {
  choose: "Choose existing dataset",
  from_production: "Import from Production",
  manual: "Create manually",
  upload: "Upload CSV",
} as const;

export const EXECUTION_METHODS = {
  realtime_on_message: "When a message arrives",
  realtime_guardrail: "As a guardrail",
  realtime_manually: "Manually",

  prompt: "Create a prompt",
  http_endpoint: "Call an HTTP endpoint",
  create_a_workflow: "Create a Workflow",
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
  workspaceTab: z.enum(["dataset", "workflow", "results", "code-implementation"]).optional(),
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

  workflowStore: WorkflowStore;
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
): EvaluationWizardStore => ({
  ...initialState,
  reset() {
    set((current) => ({
      ...current,
      ...initialState,
      workflowStore: { ...current.workflowStore, ...initialWorkflowStore },
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
      const hasEntryNode = current.nodes.some((node) => node.type === "entry");

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
      const firstEvaluator = current.nodes[firstEvaluatorIndex] ?? {
        id: nameToId(initialEvaluator.name ?? initialEvaluator.cls),
        type: "evaluator",
        data: initialEvaluator,
        position: { x: 600, y: 0 },
      };

      const evaluatorNode: Node<Evaluator> = {
        ...firstEvaluator,
        data: {
          ...(firstEvaluator.data as Evaluator),
          ...evaluator,
          parameters:
            evaluator.parameters ??
            // Reset parameters if not given the evaluator is not the same as the current evaluator
            (firstEvaluator.data.cls !== evaluator.cls
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

      return {
        ...current,
        nodes: current.nodes.map((node, index) =>
          index === firstEvaluatorIndex ? evaluatorNode : node
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
          ...current.edges.filter((edge) => edge.target !== firstEvaluator.id),
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
  workflowStore: workflowStore(
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
  ),
});

export const useEvaluationWizardStore = create<EvaluationWizardStore>()(store);
