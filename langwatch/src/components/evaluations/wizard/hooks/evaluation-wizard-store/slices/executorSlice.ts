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
   * Delete all executor nodes and edges
   */
  deleteAllExecutorNodes: () => void;
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
  }: {
    type: "signature" | "code";
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
  return {
    getFirstExecutorNode: () => {
      const workflow = get().workflowStore.getWorkflow();
      return workflow.nodes.find(
        (node) => node.type && EXECUTOR_NODE_TYPES.includes(node.type)
      );
    },
    deleteAllExecutorNodes: () => {
      get().workflowStore.setWorkflow((current) => {
        // Split nodes
        // TODO: See if this is already available somewhere
        const [nodesToKeep, nodesToDelete] = current.nodes.reduce(
          (acc, node) => {
            if (!node.type) return acc;
            if (EXECUTOR_NODE_TYPES.includes(node.type)) {
              acc[1].push(node);
            } else {
              acc[0].push(node);
            }

            return acc;
          },
          [[], []] as [Node<Component>[], Node<Component>[]]
        );

        return {
          ...current,
          nodes: nodesToKeep,
          edges: current.edges.filter((edge) => {
            return nodesToDelete.find((node) => {
              node.id === edge.source || edge.target;
            });
          }),
        };
      });
    },
    upsertExecutorNodeByType: ({ type }: { type: "signature" | "code" }) => {
      get().deleteAllExecutorNodes();
      switch (type) {
        case "signature":
          return get().addNewSignatureNodeToWorkflow();
        case "code":
          return get().addCodeExecutionNodeToWorkflow();
        default:
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          throw new Error(`Unknown executor node type: ${type}`);
      }
    },
  };
};
