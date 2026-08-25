import type { Node, NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import { forwardRef } from "react";
import type { Evaluator } from "@langwatch/workflow-contract";
import { ComponentNode } from "./workflow-nodes";

export const EvaluatorNode = forwardRef(function EvaluatorNode(
  props: NodeProps<Node<Evaluator>>,
  ref: Ref<HTMLDivElement>,
) {
  return <ComponentNode ref={ref} {...props} />;
});
