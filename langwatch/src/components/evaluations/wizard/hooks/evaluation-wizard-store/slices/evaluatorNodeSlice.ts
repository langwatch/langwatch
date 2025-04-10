import { type Edge, type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type {
  Evaluator,
  Workflow,
  Entry,
} from "~/optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { buildEvaluatorFromType } from "~/optimization_studio/utils/registryUtils";
import { nameToId } from "~/optimization_studio/utils/nodeUtils";
import {
  buildEntryToTargetEdges,
  buildExecutorToEvaluatorEdge,
} from "./utils/edge.util";
import type { ExecutorSlice } from "./executorSlice";

const createEvaluatorData = (): Omit<Node<Evaluator>, "position"> => ({
  id: "evaluator_node",
  type: "evaluator",
  data: {
    name: "New Evaluator",
    cls: "evaluator",
    parameters: [],
    inputs: [],
    outputs: [],
  },
});

export interface EvaluatorNodeSlice {
  createNewEvaluatorNode: () => Node<Evaluator>;
  addNewEvaluatorNodeToWorkflow: () => string;
  setFirstEvaluator: (
    evaluator: Partial<Evaluator> & { evaluator: EvaluatorTypes }
  ) => void;
  getFirstEvaluatorNode: () => Node<Evaluator> | undefined;
  setFirstEvaluatorEdges: (edges: Workflow["edges"]) => void;
  getFirstEvaluatorEdges: () => Workflow["edges"] | undefined;
}

export const createEvaluatorNodeSlice: StateCreator<
  BaseNodeSlice & { workflowStore: WorkflowStore } & EvaluatorNodeSlice &
    ExecutorSlice,
  [],
  [],
  EvaluatorNodeSlice
> = (set, get) => {
  return {
    createNewEvaluatorNode: (): Node<Evaluator> =>
      get().createNewNode(createEvaluatorData()),

    addNewEvaluatorNodeToWorkflow: (): string =>
      get().addNodeToWorkflow(get().createNewEvaluatorNode()),
    /**
     * Creates or updates the first evaluator node in the workflow.
     *
     * If no evaluator node exists, it creates a new one with the specified evaluator type.
     * If an evaluator node already exists, it updates it with the new properties while
     * preserving existing parameters unless the evaluator type has changed.
     *
     * When the evaluator type changes, it:
     * 1. Resets the parameters to default values
     * 2. Maintains the node's position in the workflow
     * 3. Preserves the node's ID based on the evaluator name/class
     *
     * This method is used by the evaluator selection and settings components to
     * configure the evaluation workflow.
     *
     * ---
     *
     * TODO: Consider simply replacing any existing evaluators when this is called,
     * rather than trying to handle a complex merge.
     */
    setFirstEvaluator(
      evaluator: Partial<Evaluator> & { evaluator: EvaluatorTypes }
    ) {
      get().workflowStore.setWorkflow((current) => {
        // Validate evaluator type
        if (evaluator.evaluator.startsWith("custom/")) {
          throw new Error("Custom evaluators are not supported yet");
        }

        // Find existing evaluator node if any
        const firstEvaluatorIndex = current.nodes.findIndex(
          (node) => node.type === "evaluator"
        );
        const previousEvaluator =
          firstEvaluatorIndex !== -1
            ? (current.nodes[firstEvaluatorIndex] as Node<Evaluator>)
            : undefined;

        // Get base evaluator properties from the evaluator type
        const initialEvaluator = buildEvaluatorFromType(evaluator.evaluator);
        const id = nameToId(initialEvaluator.name ?? initialEvaluator.cls);

        // Check if evaluator type has changed
        const hasEvaluatorChanged =
          previousEvaluator?.data.evaluator !== evaluator.evaluator;

        // Determine base node to use (create new or use existing)
        const baseEvaluatorNode =
          hasEvaluatorChanged || !previousEvaluator
            ? {
                id,
                type: "evaluator",
                data: initialEvaluator,
                position: { x: 600, y: 0 },
              }
            : previousEvaluator;

        // Create the final evaluator node with merged properties
        const evaluatorNode: Node<Evaluator> = {
          ...baseEvaluatorNode,
          id,
          deletable: false,
          data: {
            ...baseEvaluatorNode.data,
            ...evaluator,
            // Preserve metadata from initial evaluator
            name: initialEvaluator.name,
            description: initialEvaluator.description,
            // Handle parameters:
            // 1. Use provided parameters if available
            // 2. Reset parameters if evaluator type changed
            // 3. Otherwise keep existing parameters
            parameters:
              evaluator.data?.parameters ??
              (hasEvaluatorChanged
                ? []
                : baseEvaluatorNode.data.parameters ?? []),
          },
        };

        const entryNode = get().getNodesByType("entry")[0] as Node<Entry>;
        let newEdges = buildEntryToTargetEdges(entryNode, evaluatorNode);

        // If there is an executor node, update the edges
        // to connect the output of the executor node to the input of the evaluator node
        // TODO: This isn't actually working.
        const executorNode = get().getFirstExecutorNode();
        if (executorNode) {
          const edge = buildExecutorToEvaluatorEdge({
            source: executorNode.id,
            target: evaluatorNode.id,
          });
          // Remove edges with the same target as the new edge
          newEdges = newEdges.filter(
            (e) =>
              !(
                e.target === edge.target && e.targetHandle === edge.targetHandle
              )
          );
          newEdges.push(edge);
        }

        // If the first evaluator node is not found,
        // simply add the new evaluator node and new edges
        if (firstEvaluatorIndex === -1) {
          return {
            ...current,
            nodes: [...current.nodes, evaluatorNode],
            edges: [...current.edges, ...newEdges],
          };
        }

        // Otherwise, update the existing evaluator and handle edges
        return {
          ...current,
          // Replace the existing evaluator node
          nodes: current.nodes.map((node, index) =>
            index === firstEvaluatorIndex ? evaluatorNode : node
          ),
          // Remove old edges targeting the evaluator and add new connections
          edges: [
            ...current.edges.filter((edge) => edge.target !== evaluatorNode.id),
            ...newEdges,
          ],
        };
      });
    },
    getFirstEvaluatorNode() {
      const node = get()
        .workflowStore.getWorkflow()
        .nodes.find((node) => node.type === "evaluator");
      if (node?.data && "evaluator" in node.data) {
        return node as Node<Evaluator>;
      }
      return undefined;
    },
    /**
     * Updates the edges by removing those that target the previous evaluator
     * and adding the new edges provided. It also updates the target of the
     * provided edges to point to the new evaluator.
     *
     * If no evaluator node is found, the current workflow is returned.
     */
    setFirstEvaluatorEdges(edges: Edge[]) {
      get().workflowStore.setWorkflow((current) => {
        const firstEvaluator = get().getFirstEvaluatorNode();

        // If no evaluator node is found, return the current workflow
        if (!firstEvaluator?.id) {
          return current;
        }

        return {
          ...current,
          edges: [
            ...current.edges.filter(
              (edge) => edge.target !== firstEvaluator.id
            ),
            ...edges.map((edge) => ({
              ...edge,
              target: firstEvaluator.id,
            })),
          ],
        };
      });
    },
    getFirstEvaluatorEdges() {
      const firstEvaluator = get().getFirstEvaluatorNode();
      if (!firstEvaluator) {
        return undefined;
      }

      return get()
        .workflowStore.getWorkflow()
        .edges.filter((edge) => edge.target === firstEvaluator.id);
    },
  };
};
