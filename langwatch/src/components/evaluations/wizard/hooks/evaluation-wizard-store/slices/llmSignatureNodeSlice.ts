import { type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  LLMConfig,
  Signature,
} from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";

export interface LlmSignatureNodeSlice {
  createNewLlmSignatureNode: () => Node<Signature>;
  addNewSignatureNodeToWorkflow: () => string;
  getOrCreateSignatureNode: () => Node<Signature>;
  updateSignatureNodeLLMConfigValue: (
    nodeId: string,
    llmConfig: LLMConfig
  ) => void;
}

export const createLlmSignatureNodeSlice: StateCreator<
  BaseNodeSlice & LlmSignatureNodeSlice,
  [],
  [],
  LlmSignatureNodeSlice
> = (set, get) => {
  return {
    createNewLlmSignatureNode: (): Node<Signature> =>
      get().createNewNode(LlmSignatureNodeFactory.build()),

    addNewSignatureNodeToWorkflow: (): string =>
      get().addNodeToWorkflow(get().createNewLlmSignatureNode()),

    /**
     * Notes:
     * - This is a specialized function to get the first signature node in the workflow
     * - If no signature node exists, it creates a new one and adds it to the workflow
     * - It is used by the LlmPromptPropertiesStepAccordion component
     */
    getOrCreateSignatureNode: (): Node<Signature> => {
      const signatureNodes = get().getNodesByType("signature");

      if (signatureNodes.length > 0) {
        return signatureNodes[0]!;
      }

      const nodeId = get().addNewSignatureNodeToWorkflow();
      return get().getNodeById(nodeId)!;
    },

    /**
     * Notes:
     * - This is a specialized function to update the LLM config value for the signature node
     * - It is used by the LlmPromptPropertiesStepAccordion component
     */
    updateSignatureNodeLLMConfigValue: (
      nodeId: string,
      llmConfig: LLMConfig
    ) => {
      get().setNodeParameter(nodeId, {
        identifier: "llm",
        type: "llm",
        value: llmConfig,
      });
    },
  };
};
