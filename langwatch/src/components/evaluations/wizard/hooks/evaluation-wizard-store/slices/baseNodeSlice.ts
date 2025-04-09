import { type Node, type Edge } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Component } from "../../../../../../optimization_studio/types/dsl";
import { createFieldMappingEdges } from "../../../../utils/field-mapping";
import { calculateNodePosition, createBaseNode } from "./utils/nodeUtils";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";

export interface BaseNodeSlice {
  getLastNode: <T extends Component>() => Node<T> | undefined;
  getNodeById: <T extends Component>(nodeId: string) => Node<T> | undefined;
  createNewNode: <T extends Component>(type: string, data: T) => Node<T>;
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

  const createNewNode = <T extends Component>(type: string, data: T) => {
    const position = calculateNodePosition(getLastNode<T>());
    return createBaseNode(type, data, position);
  };

  const addNodeToWorkflow = (node: Node<Component>): string => {
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
