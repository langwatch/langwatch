import type { ComponentType } from "../../types/dsl";
import { EntryNode } from "./EntryNode";
import { EvaluatorNode } from "./EvaluatorNode";
import { ComponentNode } from "./Nodes";
import { SignatureNode } from "./SignatureNode";
import { EndNode } from "./EndNode";

export const NodeComponents: Record<
  ComponentType,
  | typeof EntryNode
  | typeof EndNode
  | typeof SignatureNode
  | typeof EvaluatorNode
  | typeof ComponentNode
> = {
  entry: EntryNode,
  signature: SignatureNode,
  evaluator: EvaluatorNode,
  end: EndNode,
  module: ComponentNode,
  retriever: ComponentNode,
  prompting_technique: ComponentNode,
};
