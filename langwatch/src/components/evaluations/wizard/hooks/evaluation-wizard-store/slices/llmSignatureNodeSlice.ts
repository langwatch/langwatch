import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  LLMConfig,
  Signature,
} from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { createDefaultEdge } from "./utils/edge.util";

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
  BaseNodeSlice & LlmSignatureNodeSlice & { workflowStore: WorkflowStore },
  [],
  [],
  LlmSignatureNodeSlice
> = (set, get) => {
  const getEntryNodeId = () => get().getNodesByType("entry")[0]?.id;

  return {
    createNewLlmSignatureNode: (): Node<Signature> =>
      get().createNewNode(LlmSignatureNodeFactory.build()),

    addNewSignatureNodeToWorkflow: (): string => {
      const node = get().createNewLlmSignatureNode();
      const entryNodeId = getEntryNodeId();
      const newEdges: Edge[] = entryNodeId
        ? [createDefaultEdge(entryNodeId, node.id)]
        : [];
      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
    },

    getOrCreateSignatureNode: (): Node<Signature> => {
      const signatureNodes = get().getNodesByType("signature");

      if (signatureNodes.length > 0) {
        return signatureNodes[0]!;
      }

      const nodeId = get().addNewSignatureNodeToWorkflow();
      return get().getNodeById(nodeId)!;
    },

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
