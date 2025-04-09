import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  Component,
  Field,
} from "../../../../../../optimization_studio/types/dsl";
import { calculateNodePosition, updateNodeParameter } from "./utils/node.util";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { NodeWithOptionalPosition } from "./types";

type NodeTypes = "signature" | "code" | "evaluator" | "entry";

export interface BaseNodeSlice {
  getLastNode: <T extends Component>() => Node<T> | undefined;
  getNodeById: <T extends Component>(nodeId: string) => Node<T> | undefined;
  /**
   * Create a new node with an optional position
   *
   * If position is not provided, it will be calculated based on the last node
   */
  createNewNode: <T extends Component>(
    node: NodeWithOptionalPosition<T>
  ) => Node<T>;
  /**
   * Adds a new node the workflow. Optionally pass in new edges as well
   * @param node - The node to add
   * @param newEdges (optional) - The edges to add to the new node
   * @returns The id of the new node
   */
  addNodeToWorkflow: <T extends Component>(
    node: Node<T>,
    newEdges?: Edge[]
  ) => string;
  getNodesByType: <T extends Component>(type: NodeTypes) => Node<T>[];
  updateNode: (
    nodeId: string,
    updater: (node: Node<Component>) => Node<Component>
  ) => void;
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

  const getLastNode = <T extends Component>() =>
    getWorkflow().nodes[getWorkflow().nodes.length - 1] as Node<T>;

  const getNodeById = <T extends Component>(nodeId: string) =>
    getWorkflow().nodes.find((node) => node.id === nodeId) as Node<T>;

  const getNodesByType: BaseNodeSlice["getNodesByType"] = (type) => {
    return getWorkflow().nodes.filter(
      (node) => node.type === type
    ) as Node<T>[];
  };

  const createNewNode = <T extends Component>(
    node: NodeWithOptionalPosition<T>
  ) => {
    const lastNode = getLastNode<T>();
    const position = node.position ?? calculateNodePosition(lastNode);
    return {
      ...node,
      position,
    };
  };

  const addNodeToWorkflow = (
    node: Node<Component>,
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
  };

  const updateNode: BaseNodeSlice["updateNode"] = (nodeId, updater) => {
    get().workflowStore.setWorkflow((current) => {
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId ? updater(node) : node
        ),
      };
    });
  };

  // Generic node parameter update function
  const setNodeParameter = (
    nodeId: string,
    parameter: Partial<Omit<Field, "value">> & {
      identifier: string;
      type: Field["type"];
      value?: unknown;
    }
  ) => {
    return updateNode(nodeId, (node) => updateNodeParameter(node, parameter));
  };

  const setNodeDataField = <T extends Component>(
    nodeId: string,
    field: "inputs" | "outputs" | "parameters",
    value: Field[]
  ) => {
    return get().updateNode(nodeId, (node) => ({
      ...node,
      data: {
        ...node.data,
        [field]: value,
      },
    }));
  };

  return {
    getNodesByType,
    getLastNode,
    getNodeById,
    createNewNode,
    addNodeToWorkflow,
    updateNode,
    setNodeParameter,
    setNodeInputs: (nodeId: string, inputs: Field[]) => {
      return setNodeDataField(nodeId, "inputs", inputs);
    },
    setNodeOutputs: (nodeId: string, outputs: Field[]) => {
      return setNodeDataField(nodeId, "outputs", outputs);
    },
  };
};
