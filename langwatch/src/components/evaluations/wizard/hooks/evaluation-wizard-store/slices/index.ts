import { createBaseNodeSlice, type BaseNodeSlice } from "./baseNodeSlice";
import {
  createLlmSignatureNodeSlice,
  type LlmSignatureNodeSlice,
} from "./llmSignatureNodeSlice";
import type { StateCreator } from "zustand";
import type { EvaluationWizardStore } from "../useEvaluationWizardStore";

export type EvaluationWizardSlicesUnion = BaseNodeSlice & LlmSignatureNodeSlice;

export const createEvaluationWizardSlicesStore: StateCreator<
  EvaluationWizardStore & EvaluationWizardSlicesUnion,
  [],
  [],
  EvaluationWizardSlicesUnion
> = (...args) => ({
  ...createBaseNodeSlice(...args),
  ...createLlmSignatureNodeSlice(...args),
});
