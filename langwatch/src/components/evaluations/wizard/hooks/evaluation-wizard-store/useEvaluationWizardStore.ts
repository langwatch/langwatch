import type { AgGridReact } from "@ag-grid-community/react";
import type { RefObject } from "react";
import { z } from "zod";
import { create } from "zustand";

import {
  initialState as initialWorkflowStore,
  type WorkflowStore,
  store as workflowStore,
  type State as WorkflowStoreState,
} from "../../../../../optimization_studio/hooks/useWorkflowStore";
import { entryNode } from "../../../../../optimization_studio/templates/blank";
import type {
  Entry,
  Workflow,
} from "../../../../../optimization_studio/types/dsl";
import { datasetColumnsToFields } from "../../../../../optimization_studio/utils/datasetUtils";
import type { DatasetColumns } from "../../../../../server/datasets/types";
import { checkPreconditionsSchema } from "../../../../../server/evaluations/types.generated";
import { mappingStateSchema } from "../../../../../server/tracer/tracesMapping";

import {
  createEvaluationWizardSlicesStore,
  type EvaluationWizardSlicesUnion,
} from "./slices";
import { buildEntryToTargetEdges } from "./slices/utils/edge.util";
import { EXECUTOR_NODE_TYPES } from "./slices/executorSlice";
import type { Node } from "@xyflow/react";
import {
  createCopilotStore,
  initialCopilotStore,
  type CopilotStore,
  type CopilotStoreState,
} from "./copilotState";

export const EVALUATOR_CATEGORIES = [
  "expected_answer",
  "llm_judge",
  "quality",
  "rag",
  "safety",
  "custom_evaluators",
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
  real_time: "Real-time evaluation",
  llm_app: "Offline evaluation",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Evaluate your Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export type TaskType = keyof typeof TASK_TYPES;

export const DATA_SOURCE_TYPES = {
  choose: "Choose existing dataset",
  from_production: "Import from Production",
  manual: "Create with AI ✨",
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
  isCopilot: boolean;
  experimentId?: string;
  experimentSlug?: string;
  wizardState: z.infer<typeof wizardStateSchema>;
  isAutosaving: boolean;
  autosaveDisabled: boolean;
  datasetGridRef?: RefObject<AgGridReact<any> | null>;

  workflowStore: WorkflowStoreState;
  copilotStore: CopilotStoreState;
};

export type EvaluationWizardStore = State & {
  reset: () => void;
  setIsCopilot: (value: boolean) => void;
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
  setDatasetGridRef: (gridRef: RefObject<AgGridReact<any> | null>) => void;

  workflowStore: WorkflowStore;
  copilotStore: CopilotStore;
};

export const initialState: State = {
  isCopilot: false,
  experimentSlug: undefined,
  wizardState: {
    step: "task",
    workspaceTab: "dataset",
  },
  isAutosaving: false,
  autosaveDisabled: false,
  workflowStore: initialWorkflowStore,
  copilotStore: initialCopilotStore,
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
  const store: EvaluationWizardStore = {
    ...initialState,
    reset() {
      set((current) => ({
        ...current,
        ...initialState,
        workflowStore: createWorkflowStore(set, get),
        copilotStore: createCopilotStore(
          (state: CopilotStoreState) =>
            set({ copilotStore: { ...current.copilotStore, ...state } }),
          () => get().copilotStore
        ),
      }));
    },
    setIsCopilot(value) {
      set((current) => ({ ...current, isCopilot: value }));
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
        const previousEntryNode = current.nodes.find(
          (node) => node.type === "entry"
        );

        // Upsert the entry node into the workflow
        let newNodes = current.nodes;
        const outputs = datasetColumnsToFields(columnTypes);
        if (previousEntryNode) {
          newNodes = current.nodes.map((node) => {
            if (node.type !== "entry") {
              return node;
            }

            return {
              ...node,
              data: {
                ...node.data,
                dataset: { id: datasetId },
                outputs,
              },
            };
          });
        } else {
          const newEntryNode = entryNode();

          newNodes = [
            ...current.nodes,
            {
              ...newEntryNode,
              data: {
                ...newEntryNode.data,
                dataset: { id: datasetId },
                outputs,
              },
            },
          ];
        }

        // Logic to disconnect the current no longer existing edges from the entry node
        const entryFields = outputs.map(
          (output) => `outputs.${output.identifier}`
        );
        let newEdges = current.edges.filter(
          (edge) =>
            edge.source !== "entry" ||
            entryFields.includes(edge.sourceHandle ?? "")
        );

        // And then connecting it again using defaults with the other existing components
        const newEntryNode = newNodes.find((node) => node.type === "entry") as
          | Node<Entry>
          | undefined;
        const otherNodes = newNodes.filter((node) => node.type !== "entry");

        const newEdgesTargetHandles = newEdges.map(
          (edge) => `${edge.target}-${edge.targetHandle}`
        );
        for (const node of otherNodes) {
          const otherNodeEdges = buildEntryToTargetEdges(
            newEntryNode,
            node
          ).filter(
            (edge) =>
              !newEdgesTargetHandles.includes(
                `${edge.target}-${edge.targetHandle}`
              )
          );
          newEdges = [...newEdges, ...otherNodeEdges];
        }

        return {
          ...current,
          nodes: newNodes,
          edges: newEdges,
        };
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
    setDatasetGridRef(gridRef) {
      set((current) => ({ ...current, datasetGridRef: gridRef }));
    },
    workflowStore: createWorkflowStore(set, get),
    copilotStore: createCopilotStore(
      (state: CopilotStoreState) =>
        set({ copilotStore: { ...get().copilotStore, ...state } }),
      () => get().copilotStore
    ),
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

export const useEvaluationWizardStore = create<
  EvaluationWizardStore & EvaluationWizardSlicesUnion
>()((...args) => ({
  ...store(args[0], args[1]),
  ...createEvaluationWizardSlicesStore(...args),
}));
