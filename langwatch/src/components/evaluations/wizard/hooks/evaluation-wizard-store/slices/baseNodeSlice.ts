import { type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Component } from "../../../../../../optimization_studio/types/dsl";
import { createFieldMappingEdges } from "../../../../utils/field-mapping";
import { calculateNodePosition } from "./utils/nodeUtils";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { NodeWithOptionalPosition } from "./types";

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
  addNodeToWorkflow: <T extends Component>(node: Node<T>) => string;
  getNodesByType: <T extends Component>(type: string) => Node<T>[];
}

export const createBaseNodeSlice: StateCreator<
  {
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

  const getNodesByType = <T extends Component>(type: string) => {
    return getWorkflow().nodes.filter(
      (node) => node.type === type
    ) as Node<T>[];
  };

  const createNewNode = <T extends Component>(
    node: NodeWithOptionalPosition<T>
  ) => {
    console.log("createNewNode", node);
    const lastNode = getLastNode<T>();
    console.log("lastNode", lastNode);
    const position = node.position ?? calculateNodePosition(lastNode);
    return {
      ...node,
      position,
    };
  };

  const addNodeToWorkflow = (node: Node<Component>): string => {
    console.log("addNodeToWorkflow", node);
    get().workflowStore.setWorkflow((current) => {
      const newEdges = createFieldMappingEdges(current, node);
      return {
        ...current,
        nodes: [...current.nodes, node],
        edges: [...current.edges, ...newEdges],
      };
    });
    return node.id;
  };

  return {
    getLastNode,
    getNodeById,
    createNewNode,
    addNodeToWorkflow,
    getNodesByType,
  };
};
