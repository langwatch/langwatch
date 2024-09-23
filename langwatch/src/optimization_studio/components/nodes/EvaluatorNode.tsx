import { type Node, type NodeProps } from "@xyflow/react";
import { ComponentNode } from "./Nodes";
import type { Evaluator } from "../../types/dsl";

export function EvaluatorNode(props: NodeProps<Node<Evaluator>>) {
  return <ComponentNode {...props} />;
}
