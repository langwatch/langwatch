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
import { createCopilotSlice, type CopilotSlice } from "./copilotSlice";

export type EvaluationWizardSlicesUnion = BaseNodeSlice &
  LlmSignatureNodeSlice &
  EvaluatorNodeSlice &
  ExecutorSlice &
  CodeExecutionSlice &
  CopilotSlice;

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
  ...createCopilotSlice(...args),
});
