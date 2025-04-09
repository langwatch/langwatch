import { type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Signature } from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";

export interface LlmSignatureNodeSlice {
  createNewLlmSignatureNode: () => Node<Signature>;
  addNewSignatureNodeToWorkflow: () => string;
  getOrCreateSignatureNode: () => Node<Signature>;
}

export const createLlmSignatureNodeSlice: StateCreator<
  BaseNodeSlice,
  [],
  [],
  LlmSignatureNodeSlice
> = (set, get) => {
  const getAllSignatureNodes = (): Node<Signature>[] =>
    get().getNodesByType("signature");

  const createNewLlmSignatureNode = (): Node<Signature> =>
    get().createNewNode(LlmSignatureNodeFactory.build());

  const addNewSignatureNodeToWorkflow = (): string =>
    get().addNodeToWorkflow(createNewLlmSignatureNode());

  const getOrCreateSignatureNode = (): Node<Signature> => {
    const signatureNodes = getAllSignatureNodes();

    if (signatureNodes.length > 0) {
      return signatureNodes[0]!;
    }

    const nodeId = addNewSignatureNodeToWorkflow();
    return get().getNodeById(nodeId)!;
  };

  return {
    createNewLlmSignatureNode,
    addNewSignatureNodeToWorkflow,
    getOrCreateSignatureNode,
  };
};
