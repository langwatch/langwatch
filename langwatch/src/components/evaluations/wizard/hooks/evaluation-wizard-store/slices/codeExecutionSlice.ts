import { type Edge } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { createDefaultEdge } from "./utils/edge.util";
import { CodeExecutionNodeFactory } from "./factories/code-execution-node.factory";

export interface CodeExecutionSlice {
  /**
   * Creates a new code execution node and adds it to the workflow
   * @returns The ID of the newly created node
   */
  addCodeExecutionNodeToWorkflow: () => string;
}

export const createCodeExecutionSlice: StateCreator<
  BaseNodeSlice & CodeExecutionSlice & { workflowStore: WorkflowStore },
  [],
  [],
  CodeExecutionSlice
> = (set, get) => {
  return {
    addCodeExecutionNodeToWorkflow: (): string => {
      // Create a new code node based on the default structure
      const entryNode = get().getNodesByType("entry")[0];
      const node = get().createNewNode(CodeExecutionNodeFactory.build());

      // Create an edge from the entry node to the code node if an entry node exists
      const entryNodeId = entryNode?.id;
      const newEdges: Edge[] = entryNodeId
        ? [createDefaultEdge(entryNodeId, node.id)]
        : [];

      // Add the node and edges to the workflow
      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
    },
  };
};
