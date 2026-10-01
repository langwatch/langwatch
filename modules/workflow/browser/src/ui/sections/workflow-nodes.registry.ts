import type { ComponentType } from "@langwatch/workflow-contract";

import { CustomNode } from "./workflow-nodes.custom.tsx";
import { EndNode } from "./workflow-nodes.end.tsx";
import { EntryNode } from "./workflow-nodes.entry.tsx";
import { EvaluatorNode } from "./workflow-nodes.evaluator.tsx";
import { PromptingTechniqueNode } from "./workflow-nodes.prompting-technique.tsx";
import { SignatureNode } from "./workflow-nodes.signature.tsx";
import { ComponentNode } from "./workflow-nodes.tsx";

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
