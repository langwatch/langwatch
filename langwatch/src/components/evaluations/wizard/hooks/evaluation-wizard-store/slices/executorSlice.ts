import { type StateCreator } from "zustand";
import { type Component } from "~/optimization_studio/types/dsl";
import { type Node } from "@xyflow/react";

const EXECUTOR_NODE_TYPES = ["signature", "code"] as string[];

export interface ExecutorSlice {
  /**
   * Get the first executor node in the workflow. There should only be one ;)
   * @returns The first executor node in the workflow
   */
  getFirstExecutorNode: () => Node<Component> | undefined;
}

export const createExecutorSlice: StateCreator<
  {
    workflowStore: {
      getWorkflow: () => {
        nodes: Node<Component>[];
      };
    };
  },
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
  };
};
