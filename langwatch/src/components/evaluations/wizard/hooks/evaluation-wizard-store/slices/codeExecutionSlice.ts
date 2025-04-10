import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import { CodeExecutionNodeFactory } from "./factories/code-execution-node.factory";
import type { ExecutorSlice } from "./executorSlice";
import type { Entry } from "~/optimization_studio/types/dsl";
import { calculateNextPosition } from "./utils/node.util";

export interface CodeExecutionSlice {
  /**
   * Creates a new code execution node and adds it to the workflow
   * Also deletes all existing executor nodes and edges
   * @returns The ID of the newly created node
   */
  addCodeExecutionNodeToWorkflow: () => string;
}

export const createCodeExecutionSlice: StateCreator<
  { workflowStore: WorkflowStore } & BaseNodeSlice &
    CodeExecutionSlice &
    ExecutorSlice,
  [],
  [],
  CodeExecutionSlice
> = (set, get) => {
  return {
    addCodeExecutionNodeToWorkflow: (): string => {
      // Create a new code node based on the default structure
      const entryNode = get().getNodesByType("entry")[0] as Node<Entry>;
      const position = calculateNextPosition(entryNode.position);
      const node = get().createNewNode(
        CodeExecutionNodeFactory.build({
          position,
        })
      );

      // Create an edge from the entry node to the code node if an entry node exists
      const entryNodeId = entryNode?.id;
      const newEdges: Edge[] = entryNodeId
        ? buildEntryToTargetEdges(entryNode, node)
        : [];

      // Add the executor  node and edges to the workflow
      get().deleteAllExecutorNodes();
      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
    },
  };
};
