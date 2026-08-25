import type { ComponentType } from "@langwatch/workflow-contract";

import { CustomNode } from "./workflow-nodes.custom";
import { EndNode } from "./workflow-nodes.end";
import { EntryNode } from "./workflow-nodes.entry";
import { EvaluatorNode } from "./workflow-nodes.evaluator";
import { PromptingTechniqueNode } from "./workflow-nodes.prompting-technique";
import { SignatureNode } from "./workflow-nodes.signature";
import { ComponentNode } from "./workflow-nodes";

/**
 * The canvas renderer map is part of the Workflow browser surface. Application
 * pages choose when to mount React Flow, but do not own the graph's node
 * renderer selection.
 */
export const workflowNodeComponents: Record<
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
