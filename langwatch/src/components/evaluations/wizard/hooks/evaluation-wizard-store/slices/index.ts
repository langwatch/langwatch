import type { StateCreator } from "zustand";
import type { EvaluationWizardStore } from "../useEvaluationWizardStore";
import { type BaseNodeSlice, createBaseNodeSlice } from "./baseNodeSlice";
import {
  type CodeExecutionSlice,
  createCodeExecutionSlice,
} from "./codeExecutionSlice";
import { createDatasetSlice, type DatasetSlice } from "./datasetSlice";
import {
  createEvaluatorNodeSlice,
  type EvaluatorNodeSlice,
} from "./evaluatorNodeSlice";
import { createExecutorSlice, type ExecutorSlice } from "./executorSlice";
import {
  createLlmSignatureNodeSlice,
  type LlmSignatureNodeSlice,
} from "./llmSignatureNodeSlice";

export type EvaluationWizardSlicesUnion = BaseNodeSlice &
  LlmSignatureNodeSlice &
  EvaluatorNodeSlice &
  ExecutorSlice &
  CodeExecutionSlice &
  DatasetSlice;

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
  ...createDatasetSlice(...args),
});
