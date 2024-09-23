import type { Node } from "@xyflow/react";
import type { Evaluator } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

export function EvaluatorPropertiesPanel({ node }: { node: Node<Evaluator> }) {
  return <BasePropertiesPanel node={node} inputsReadOnly outputsReadOnly />;
}
