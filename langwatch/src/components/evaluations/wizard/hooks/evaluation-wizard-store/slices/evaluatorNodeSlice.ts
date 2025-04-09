import { type Node } from "@xyflow/react";
import { type StateCreator } from "zustand";
import type { Evaluator } from "../../../../../../optimization_studio/types/dsl";
import type { BaseNodeSlice } from "./baseNodeSlice";

const createEvaluatorData = (): Evaluator => ({
  name: "New Evaluator",
  parameters: [],
  inputs: [],
  outputs: [],
  cls: "evaluator",
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
    get().createNewNode("evaluator", createEvaluatorData());

  const addNewEvaluatorNodeToWorkflow = (): string =>
    get().addNodeToWorkflow(createNewEvaluatorNode());

  return {
    createNewEvaluatorNode,
    addNewEvaluatorNodeToWorkflow,
  };
};
