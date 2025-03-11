import { create } from "zustand";
import type { EvaluatorTypes } from "../server/evaluations/evaluators.generated";
import type { Workflow } from "../optimization_studio/types/dsl";
import { initialDSL } from "../optimization_studio/hooks/useWorkflowStore";

export const steps = ["task", "dataset", "executor", "evaluation", "finalize"] as const;
export type Step = typeof steps[number];

type State = {
  experimentId?: string;
  wizardState: {
    step: Step;
    task?: "real-time"; // | "llm-pipeline" | "prompt-creation"
    dataSource?: "choose" | "from_production" | "manual" | "upload";
    datasetId?: string;

    // execution:

    evaluatorCategory?:
      | "expected_answer"
      | "quality_aspects"
      | "llm_as_a_judge"
      | "safety"
      | "rag_quality"
      | "custom";
    evaluator?: { langevals: EvaluatorTypes } | { custom: string };
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
};

const initialState: State = {
  experimentId: undefined,
  wizardState: {
    step: 'task',
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
});

export const useEvaluationWizardStore = create<EvaluationWizardStore>()(store);
