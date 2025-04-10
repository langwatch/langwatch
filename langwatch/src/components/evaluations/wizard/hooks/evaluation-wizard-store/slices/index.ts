import { createBaseNodeSlice, type BaseNodeSlice } from "./baseNodeSlice";
import {
  createLlmSignatureNodeSlice,
  type LlmSignatureNodeSlice,
} from "./llmSignatureNodeSlice";
import type { StateCreator } from "zustand";
import type { EvaluationWizardStore } from "../useEvaluationWizardStore";
import {
  createEvaluatorNodeSlice,
  type EvaluatorNodeSlice,
} from "./evaluatorNodeSlice";
import { createExecutorSlice, type ExecutorSlice } from "./executorSlice";
import {
  createCodeExecutionSlice,
  type CodeExecutionSlice,
} from "./codeExecutionSlice";

export type EvaluationWizardSlicesUnion = BaseNodeSlice &
  LlmSignatureNodeSlice &
  EvaluatorNodeSlice &
  ExecutorSlice &
  CodeExecutionSlice;

export const createEvaluationWizardSlicesStore: StateCreator<
  EvaluationWizardStore & EvaluationWizardSlicesUnion,
  [],
  [],
  EvaluationWizardSlicesUnion
> = (...args) => ({
  ...createBaseNodeSlice(...args),
  ...createLlmSignatureNodeSlice(...args),
  ...createEvaluatorNodeSlice(...args),
  ...createExecutorSlice(...args),
  ...createCodeExecutionSlice(...args),
});
