import type { Node, NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import { forwardRef } from "react";
import type { Evaluator } from "../../types/dsl";
import { ComponentNode } from "./Nodes";

export const EvaluatorNode = forwardRef(function EvaluatorNode(
  props: NodeProps<Node<Evaluator>>,
  ref: Ref<HTMLDivElement>,
) {
  return <ComponentNode ref={ref} {...props} />;
});
