import type { ComponentType } from "@langwatch/workflow-contract";
import {
  CustomNode,
  EndNode,
  EntryNode,
  EvaluatorNode,
  PromptingTechniqueNode,
  SignatureNode,
} from "@langwatch/workflow-web";
import { ComponentNode } from "./Nodes";

export const NodeComponents: Record<
  ComponentType,
  | typeof EntryNode
  | typeof EndNode
  | typeof SignatureNode
  | typeof EvaluatorNode
  | typeof ComponentNode
  | typeof CustomNode
> = {
  entry: EntryNode,
  signature: SignatureNode,
  evaluator: EvaluatorNode,
  end: EndNode,
  code: ComponentNode,
  http: ComponentNode,
  agent: ComponentNode,
  retriever: ComponentNode,
  prompting_technique: PromptingTechniqueNode,
  custom: CustomNode,
  if_else: ComponentNode,
};
