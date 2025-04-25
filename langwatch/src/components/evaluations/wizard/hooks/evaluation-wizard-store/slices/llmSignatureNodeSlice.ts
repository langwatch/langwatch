import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";

import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import { calculateNextPosition } from "./utils/node.util";

import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type {
  Entry,
  LLMConfig,
  Signature,
} from "~/optimization_studio/types/dsl";

export interface LlmSignatureNodeSlice {
  createNewLlmSignatureNode: ({
    project,
  }: {
    project?: { defaultModel?: string | null };
  }) => Node<Signature>;
  addNewSignatureNodeToWorkflow: ({
    project,
  }: {
    project?: { defaultModel?: string | null };
  }) => string;
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
    createNewLlmSignatureNode: ({ project }): Node<Signature> => {
      const entryNode = getEntryNode();
      const position = entryNode
        ? calculateNextPosition(entryNode.position)
        : { x: 0, y: 0 };

      const newNode = LlmSignatureNodeFactory.build(
        {
          position,
        },
        project
      );

      return get().createNewNode(newNode);
    },

    addNewSignatureNodeToWorkflow: ({ project }): string => {
      const node = get().createNewLlmSignatureNode({ project });
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
