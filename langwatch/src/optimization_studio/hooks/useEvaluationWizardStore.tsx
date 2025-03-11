import { create } from "zustand";
import type { EvaluatorTypes } from "../../server/evaluations/evaluators.generated";
import type { Workflow } from "../types/dsl";
import { initialDSL } from "./useWorkflowStore";

type State = {
  experiment_id?: string;
  wizard_state: {
    step?: "task" | "dataset" | "executor" | "evaluation" | "finalize";
    task?: "real-time"; // | "llm-pipeline" | "prompt-creation"
    // data_source: "choose" | "from-production" | "manual" | "upload"
    data_source?: "from-production";
    // execution:
    evaluator_category?:
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
      | Partial<State["wizard_state"]>
      | ((state: State["wizard_state"]) => Partial<State["wizard_state"]>)
  ) => void;
  getWizardState: () => State["wizard_state"];
  setDSL: (
    dsl:
      | Partial<State["dsl"]>
      | ((state: State["dsl"]) => Partial<State["dsl"]>)
  ) => void;
  getDSL: () => State["dsl"];
};

const initialState: State = {
  experiment_id: undefined,
  wizard_state: {},
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
    set((current) => ({ ...current, experiment_id }));
  },
  getExperimentId() {
    return get().experiment_id;
  },
  setWizardState(state) {
    if (typeof state === "function") {
      set((current) => ({
        ...current,
        wizard_state: {
          ...current.wizard_state,
          ...state(current.wizard_state),
        },
      }));
    } else {
      set((current) => ({
        ...current,
        wizard_state: { ...current.wizard_state, ...state },
      }));
    }
  },
  getWizardState() {
    return get().wizard_state;
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
