import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Code } from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import { createDefaultEdge } from "./utils/edge.util";
import type { NodeWithOptionalPosition } from "./types";
import { calculateNodePosition } from "./utils/node.util";

export interface CodeExecutionSlice {
  /**
   * Creates a new code execution node and adds it to the workflow
   * @returns The ID of the newly created node
   */
  addCodeExecutionNodeToWorkflow: () => string;
  /**
   * Get or create a code execution node
   * @returns The ID of the code execution node
   */
  getOrCreateCodeExecutionNode: () => string;
}

/**
 * Factory function to create a default Code node
 * @returns A new Code node with default configuration
 */
const createDefaultCodeNode = (): NodeWithOptionalPosition<Code> => ({
  id: "code_node",
  type: "code",
  data: {
    name: "Code",
    description: "Python code block",
    parameters: [
      {
        identifier: "code",
        type: "code",
        value: `import dspy

class Code(dspy.Module):
    def forward(self, question: str):
        # Your code goes here

        return {"answer": "Hello world!"}
`,
      },
    ],
    inputs: [
      {
        identifier: "input",
        type: "str",
      },
    ],
    outputs: [
      {
        identifier: "output",
        type: "str",
      },
    ],
  },
});

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
      const position = entryNode?.position
        ? calculateNodePosition(entryNode)
        : { x: 0, y: 0 };
      const node = {
        ...createDefaultCodeNode(),
        position,
      };

      // Create an edge from the entry node to the code node if an entry node exists
      const entryNodeId = entryNode?.id;
      const newEdges: Edge[] = entryNodeId
        ? [createDefaultEdge(entryNodeId, node.id)]
        : [];

      // Add the node and edges to the workflow
      const nodeId = get().addNodeToWorkflow({ ...node, position }, newEdges);
      return nodeId;
    },
    getOrCreateCodeExecutionNode: () => {
      const node = get().getNodesByType("code")[0];
      if (node) {
        return node.id;
      }
      return get().addCodeExecutionNodeToWorkflow();
    },
  };
};
