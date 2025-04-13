import { type StateCreator } from "zustand";
import { type Component } from "~/optimization_studio/types/dsl";
import { type Node } from "@xyflow/react";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { CodeExecutionSlice } from "./codeExecutionSlice";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { LlmSignatureNodeSlice } from "./llmSignatureNodeSlice";
const EXECUTOR_NODE_TYPES = ["signature", "code"] as string[];

type NodeId = string;

export interface ExecutorSlice {
  /**
   * Get the first executor node in the workflow. There should only be one ;)
   * @returns The first executor node in the workflow
   */
  getFirstExecutorNode: () => Node<Component> | undefined;
  /**
   * Upsert an executor node by type
   *
   * Since we only allow one executor node in the wizard workflow,
   * we can use this to either add or replace with default settings.
   * @param type The type of node to upsert
   * @returns The ID of the newly created node
   */
  upsertExecutorNodeByType: ({
    type,
    project,
  }: {
    type: "signature" | "code";
    project?: { defaultModel?: string | null };
  }) => NodeId;
}

export const createExecutorSlice: StateCreator<
  { workflowStore: WorkflowStore } & ExecutorSlice &
    BaseNodeSlice &
    CodeExecutionSlice &
    LlmSignatureNodeSlice,
  [],
  [],
  ExecutorSlice
> = (_set, get) => {
  const createNodeByType = (
    type: "signature" | "code",
    project?: { defaultModel?: string | null }
  ) => {
    switch (type) {
      case "signature":
        return get().createNewLlmSignatureNode({ project });
      case "code":
        return get().createNewCodeExecutionNode();
      default:
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unknown executor node type: ${type}`);
    }
  };

  return {
    getFirstExecutorNode: () => {
      const workflow = get().workflowStore.getWorkflow();
      return workflow.nodes.find(
        (node) => node.type && EXECUTOR_NODE_TYPES.includes(node.type)
      );
    },
    upsertExecutorNodeByType: ({ type, project }) => {
      const existingExecutorNode = get().getFirstExecutorNode();
      const node = createNodeByType(type, project);

      if (!existingExecutorNode) {
        switch (type) {
          case "signature":
            return get().addNewSignatureNodeToWorkflow({ project });
          case "code":
            return get().addCodeExecutionNodeToWorkflow();
          default:
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            throw new Error(`Unknown executor node type: ${type}`);
        }
      } else {
        // Make sure the new node has the same inputs and outputs as the existing node
        node.data.inputs = existingExecutorNode?.data.inputs;
        node.data.outputs = existingExecutorNode?.data.outputs;
        get().replaceNode(existingExecutorNode.id, node);
        return node.id;
      }
    },
  };
};
