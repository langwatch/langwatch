import type { Edge, Node } from "@xyflow/react";
import type { StateCreator } from "zustand";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { Code, Entry } from "~/optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { ExecutorSlice } from "./executorSlice";
import { CodeExecutionNodeFactory } from "./factories/code-execution-node.factory";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import { calculateNextPosition } from "./utils/node.util";

export interface CodeExecutionSlice {
  /**
   * Creates a new code execution node and adds it to the workflow
   * with edges from the entry node to the new node
   * @returns The ID of the newly created node
   */
  addCodeExecutionNodeToWorkflow: () => string;
  /**
   * Creates a new code execution node but does not add it to the workflow
   */
  createNewCodeExecutionNode: () => Node<Code>;
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
    createNewCodeExecutionNode: (): Node<Code> => {
      const entryNode = get().getNodesByType("entry")[0] as Node<Entry>;
      const position = entryNode
        ? calculateNextPosition(entryNode.position)
        : { x: 0, y: 0 };
      return get().createNewNode(
        CodeExecutionNodeFactory.build({
          position,
        }),
      );
    },
    addCodeExecutionNodeToWorkflow: (): string => {
      // Create a new code node based on the default structure
      const node = get().createNewCodeExecutionNode();
      // Create an edge from the entry node to the code node if an entry node exists
      const entryNode = get().getNodesByType("entry")[0] as
        | Node<Entry>
        | undefined;
      const newEdges: Edge[] = entryNode
        ? buildEntryToTargetEdges(entryNode, node)
        : [];

      // Add the executor  node and edges to the workflow
      const nodeId = get().addNodeToWorkflow(node, newEdges);
      return nodeId;
    },
  };
};
