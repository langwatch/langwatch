import type { StateCreator } from "zustand";
import type { EvaluationWizardStore } from "../useEvaluationWizardStore";
import type { CopilotStore } from "../copilotState";
import type { ExecutorSlice } from "./executorSlice";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";

export type CopilotSlice = {
  setCode: (code: string) => void;
};

export const createCopilotSlice: StateCreator<
  { copilotStore: CopilotStore } & BaseNodeSlice &
  CopilotSlice &
  ExecutorSlice,
  [],
  [],
  CopilotSlice
> = (_set, get) => {
  return {
    setCode: (code: string) => {
      get().copilotStore.setCode(code);
    },
  };
};
