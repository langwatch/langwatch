import type { Edge, Node } from "@xyflow/react";
import type { StateCreator } from "zustand";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type {
  Entry,
  LLMConfig,
  Signature,
} from "~/optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import { LlmSignatureNodeFactory } from "./factories/llm-signature-node.factory";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import { calculateNextPosition } from "./utils/node.util";

export interface LlmSignatureNodeSlice {
  createNewLlmSignatureNode: (args: {
    /** Cascade-resolved default model from
     *  `api.modelProvider.getResolvedDefault` at the React caller. Empty
     *  string is a valid value — the LLM-node UI surfaces the missing
     *  default at first run via the MissingModelToast interceptor. */
    defaultModel?: string;
  }) => Node<Signature>;
  addNewSignatureNodeToWorkflow: (args: {
    defaultModel?: string;
  }) => string;
  updateSignatureNodeLLMConfigValue: (
    nodeId: string,
    llmConfig: LLMConfig,
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
    createNewLlmSignatureNode: ({ defaultModel }): Node<Signature> => {
      const entryNode = getEntryNode();
      const position = entryNode
        ? calculateNextPosition(entryNode.position)
        : { x: 0, y: 0 };

      const newNode = LlmSignatureNodeFactory.build(
        {
          position,
        },
        defaultModel,
      );

      return get().createNewNode(newNode);
    },

    addNewSignatureNodeToWorkflow: ({ defaultModel }): string => {
      const node = get().createNewLlmSignatureNode({ defaultModel });
      const entryNode = getEntryNode();
      const newEdges: Edge[] = entryNode
        ? buildEntryToTargetEdges(entryNode, node)
        : [];

      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
    },

    updateSignatureNodeLLMConfigValue: (
      nodeId: string,
      llmConfig: LLMConfig,
    ) => {
      get().setNodeParameter(nodeId, {
        identifier: "llm",
        type: "llm",
        value: llmConfig,
      });
    },
  };
};
