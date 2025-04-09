import { type StateCreator } from "zustand";
import { createBaseNodeSlice } from "./baseNodeSlice";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { createSignatureNodeSlice } from "./llmSignatureNodeSlice";
import type { SignatureNodeSlice } from "./llmSignatureNodeSlice";
import { createEvaluatorNodeSlice } from "./evaluatorNodeSlice";
import type { EvaluatorNodeSlice } from "./evaluatorNodeSlice";
import type { EvaluationWizardStore } from "../useEvaluationWizardStore";

export type NodeSlice = BaseNodeSlice & SignatureNodeSlice & EvaluatorNodeSlice;

export const createNodeSlice: StateCreator<
  EvaluationWizardStore,
  [],
  [],
  NodeSlice
> = (set, get, store) => ({
  ...createBaseNodeSlice(set, get, store),
  ...createSignatureNodeSlice(set, get, store),
  ...createEvaluatorNodeSlice(set, get, store),
});
