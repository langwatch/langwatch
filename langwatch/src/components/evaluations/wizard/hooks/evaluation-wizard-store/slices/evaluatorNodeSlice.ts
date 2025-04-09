import { type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Evaluator } from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";

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
}

export const createEvaluatorNodeSlice: StateCreator<
  BaseNodeSlice,
  [],
  [],
  EvaluatorNodeSlice
> = (set, get) => {
  const createNewEvaluatorNode = (): Node<Evaluator> =>
    get().createNewNode(createEvaluatorData());

  const addNewEvaluatorNodeToWorkflow = (): string =>
    get().addNodeToWorkflow(createNewEvaluatorNode());

  return {
    createNewEvaluatorNode,
    addNewEvaluatorNodeToWorkflow,
  };
};
