import type { ComponentType } from "../../types/dsl";
import { CustomNode } from "./CustomNode";
import { EndNode } from "./EndNode";
import { EntryNode } from "./EntryNode";
import { EvaluatorNode } from "./EvaluatorNode";
import { ComponentNode } from "./Nodes";
import { PromptingTechniqueNode } from "./PromptingTechniqueNode";
import { SignatureNode } from "./SignatureNode";

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
};
