import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  Entry,
  LLMConfig,
  Signature,
} from "~/optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import { calculateNextPosition } from "./utils/node.util";

export interface LlmSignatureNodeSlice {
  createNewLlmSignatureNode: () => Node<Signature>;
  addNewSignatureNodeToWorkflow: () => string;
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
  const getEntryNode: () => Node<Entry> | undefined = () =>
    get().getNodesByType("entry")[0] as Node<Entry> | undefined;

  return {
    createNewLlmSignatureNode: (): Node<Signature> => {
      const entryNode = getEntryNode();
      const position = entryNode
        ? calculateNextPosition(entryNode.position)
        : { x: 0, y: 0 };
      return get().createNewNode(
        LlmSignatureNodeFactory.build({
          position,
        })
      );
    },

    addNewSignatureNodeToWorkflow: (): string => {
      const node = get().createNewLlmSignatureNode();
      const entryNode = getEntryNode();
      const newEdges: Edge[] = entryNode
        ? buildEntryToTargetEdges(entryNode, node)
        : [];

      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
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
