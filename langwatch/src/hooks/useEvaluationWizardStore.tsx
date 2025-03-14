import { create } from "zustand";
import type {
  AVAILABLE_EVALUATORS,
  Evaluators,
} from "~/server/evaluations/evaluators.generated";
import type {
  Entry,
  Evaluator,
  Workflow,
} from "../optimization_studio/types/dsl";
import { initialDSL } from "../optimization_studio/hooks/useWorkflowStore";
import type { Node } from "@xyflow/react";
import { entryNode } from "../optimization_studio/templates/blank";
import { nameToId } from "../optimization_studio/utils/nodeUtils";
import { convertEvaluator } from "../optimization_studio/utils/registryUtils";

export type EvaluatorCategory =
  | "expected_answer"
  | "llm_judge"
  | "quality"
  | "rag"
  | "safety";

export const steps = [
  "task",
  "dataset",
  "executor",
  "evaluator",
  "configuration",
  "finalize",
] as const;
export type Step = (typeof steps)[number];

export type State = {
  experimentId?: string;
  wizardState: {
    step: Step;
    task?: "real-time" | "batch" | "prompt" | "custom" | "scan";
    dataSource?: "choose" | "from_production" | "manual" | "upload";
    evaluatorCategory?: EvaluatorCategory;
    evaluatorMappings?: Record<string, string>;
  };
  dsl: Workflow;
};

type EvaluationWizardStore = State & {
  reset: () => void;
  setExperimentId: (experiment_id: string) => void;
  getExperimentId: () => string | undefined;
  setWizardState: (
    state:
      | Partial<State["wizardState"]>
      | ((state: State["wizardState"]) => Partial<State["wizardState"]>)
  ) => void;
  getWizardState: () => State["wizardState"];
  setDSL: (
    dsl:
      | Partial<State["dsl"]>
      | ((state: State["dsl"]) => Partial<State["dsl"]>)
  ) => void;
  getDSL: () => State["dsl"];
  nextStep: () => void;
  setDatasetId: (datasetId: string) => void;
  getDatasetId: () => string | undefined;
  setFirstEvaluator: (
    evaluator: Partial<Evaluator> & { evaluator: string }
  ) => void;
  getFirstEvaluator: () => Evaluator | undefined;
};

const initialState: State = {
  experimentId: undefined,
  wizardState: {
    step: "task",
  },
  dsl: initialDSL,
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
    set(initialState);
  },
  setExperimentId(experiment_id) {
    set((current) => ({ ...current, experimentId: experiment_id }));
  },
  getExperimentId() {
    return get().experimentId;
  },
  setWizardState(state) {
    if (typeof state === "function") {
      set((current) => ({
        ...current,
        wizardState: {
          ...current.wizardState,
          ...state(current.wizardState),
        },
      }));
    } else {
      set((current) => ({
        ...current,
        wizardState: { ...current.wizardState, ...state },
      }));
    }
  },
  getWizardState() {
    return get().wizardState;
  },
  setDSL(dsl) {
    if (typeof dsl === "function") {
      set((current) => ({
        ...current,
        dsl: { ...current.dsl, ...dsl(current.dsl) },
      }));
    } else {
      set((current) => ({
        ...current,
        dsl: { ...current.dsl, ...dsl },
      }));
    }
  },
  getDSL() {
    return get().dsl;
  },
  nextStep() {
    set((current) => {
      const currentStepIndex = steps.indexOf(current.wizardState.step);
      if (currentStepIndex < steps.length - 1) {
        const nextStep = steps[currentStepIndex + 1];
        if (
          nextStep === "executor" &&
          current.wizardState.task === "real-time"
        ) {
          return {
            ...current,
            wizardState: { ...current.wizardState, step: "evaluator" },
          };
        } else {
          return {
            ...current,
            wizardState: { ...current.wizardState, step: nextStep! },
          };
        }
      }
      return current;
    });
  },
  setDatasetId(datasetId) {
    get().setDSL((current) => {
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
              data: { ...node.data, dataset: { id: datasetId } },
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
              },
            },
          ],
        };
      }
    });
  },
  getDatasetId() {
    const entryNodeData = get().dsl.nodes.find((node) => node.type === "entry")
      ?.data;
    if (entryNodeData && "dataset" in entryNodeData) {
      return entryNodeData.dataset?.id;
    }
    return undefined;
  },
  setFirstEvaluator(evaluator: Partial<Evaluator> & { evaluator: string }) {
    get().setDSL((current) => {
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
        position: { x: 1200, y: 130 },
      };

      const evaluatorNode: Node<Evaluator> = {
        ...firstEvaluator,
        data: {
          ...(firstEvaluator.data as Evaluator),
          ...evaluator,
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
  getFirstEvaluator() {
    const nodeData = get().dsl.nodes.find((node) => node.type === "evaluator")
      ?.data;
    if (nodeData && "evaluator" in nodeData) {
      return nodeData;
    }
    return undefined;
  },
});

export const useEvaluationWizardStore = create<EvaluationWizardStore>()(store);
