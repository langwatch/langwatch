import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  Component,
  Field,
} from "../../../../../../optimization_studio/types/dsl";
import { calculateNextPosition, updateNodeParameter } from "./utils/node.util";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { NodeWithOptionalPosition } from "../../../../../../types";

type NodeTypes = "signature" | "code" | "evaluator" | "entry";

export interface BaseNodeSlice {
  getLastNode: <T extends Component>() => Node<T> | undefined;
  getNodeById: <T extends Component>(nodeId: string) => Node<T> | undefined;
  getNodesByType: <T extends Component>(type: NodeTypes) => Node<T>[];

  /**
   * Create a new node with an optional position
   * @param node - The node data to create
   * @param node.position - The position of the node - optional - if not provided, it will be calculated based on the last node
   * @returns A new node with position
   */
  createNewNode: <T extends Component>(
    node: NodeWithOptionalPosition<T>
  ) => Node<T>;

  /**
   * Adds a new node the workflow. Optionally pass in new edges as well
   * @returns The id of the new node
   */
  addNodeToWorkflow: <T extends Component>(
    node: Node<T>,
    newEdges?: Edge[]
  ) => string;

  /**
   * Update a node with a custom updater function
   * @param nodeId - The ID of the node to update
   * @param updater - Function that receives the current node and returns the updated node
   */
  updateNode: <T extends Component>(
    nodeId: string,
    updater: (node: Node<T>) => Node<T>
  ) => void;

  // Setters

  setNodeInputs: (nodeId: string, inputs: Field[]) => void;
  setNodeOutputs: (nodeId: string, outputs: Field[]) => void;
  setNodeParameter: (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: unknown;
    }
  ) => void;
  /**
   * Replace node with a new node
   * @param nodeId - The ID of the node to replace
   * @param newNode - The new node to replace the old node with
   */
  replaceNode: <T extends Component>(nodeId: string, newNode: Node<T>) => void;
}

export const createBaseNodeSlice: StateCreator<
  BaseNodeSlice & {
    workflowStore: WorkflowStore;
  },
  [],
  [],
  BaseNodeSlice
> = (_set, get) => {
  const getWorkflow = () => get().workflowStore.getWorkflow();

  return {
    getLastNode: <T extends Component>() =>
      getWorkflow().nodes[getWorkflow().nodes.length - 1] as Node<T>,

    getNodeById: <T extends Component>(nodeId: string) =>
      getWorkflow().nodes.find((node) => node.id === nodeId) as Node<T>,

    getNodesByType: <T extends Component>(type: NodeTypes) => {
      return getWorkflow().nodes.filter(
        (node) => node.type === type
      ) as Node<T>[];
    },

    createNewNode: <T extends Component>(node: NodeWithOptionalPosition<T>) => {
      const lastNode = get().getLastNode<T>();
      const position =
        // If the node has a position, use it
        node.position ??
        // If there is a last node, calculate the next position
        (lastNode ? calculateNextPosition(lastNode.position) : { x: 0, y: 0 });

      return {
        ...node,
        position,
      };
    },

    addNodeToWorkflow: <T extends Component>(
      node: Node<T>,
      newEdges?: Edge[]
    ): string => {
      get().workflowStore.setWorkflow((current) => {
        return {
          ...current,
          nodes: [...current.nodes, node],
          edges: newEdges ? [...current.edges, ...newEdges] : current.edges,
        };
      });

      return node.id;
    },

    updateNode: <T extends Component>(
      nodeId: string,
      updater: (node: Node<T>) => Node<T>
    ) => {
      get().workflowStore.setWorkflow((current) => {
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId ? updater(node as Node<T>) : node
          ),
        };
      });
    },

    setNodeParameter: (
      nodeId: string,
      parameter: Partial<Omit<Field, "value">> & {
        identifier: string;
        type: Field["type"];
        value?: unknown;
      }
    ) => {
      return get().updateNode(nodeId, (node) =>
        updateNodeParameter(node, parameter)
      );
    },

    setNodeInputs: <T extends Component>(nodeId: string, inputs: Field[]) => {
      return get().updateNode<T>(nodeId, (node) => ({
        ...node,
        data: {
          ...node.data,
          inputs,
        },
      }));
    },

    setNodeOutputs: <T extends Component>(nodeId: string, outputs: Field[]) => {
      return get().updateNode<T>(nodeId, (node) => ({
        ...node,
        data: {
          ...node.data,
          outputs,
        },
      }));
    },

    replaceNode: <T extends Component>(nodeId: string, newNode: Node<T>) => {
      get().workflowStore.setWorkflow((current) => {
        return {
          ...current,
          // Replace the node with the new node
          nodes: current.nodes.map((node) => {
            if (node.id === nodeId) {
              return {
                ...newNode,
                // Keep the same position as the old node
                position: node.position,
              };
            }
            return node;
          }),
          // Replace the edges with the new edges
          edges: current.edges.map((edge) => {
            return {
              ...edge,
              source: edge?.source === nodeId ? newNode.id : edge?.source,
              target: edge?.target === nodeId ? newNode.id : edge?.target,
            };
          }),
        };
      });
    },
  };
};
