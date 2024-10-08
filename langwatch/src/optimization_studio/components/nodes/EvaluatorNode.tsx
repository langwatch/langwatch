import { type Node, type NodeProps } from "@xyflow/react";
import { ComponentNode } from "./Nodes";
import type { Evaluator } from "../../types/dsl";
import { forwardRef } from "react";
import type { Ref } from "react";

export const EvaluatorNode = forwardRef(function EvaluatorNode(
  props: NodeProps<Node<Evaluator>>,
  ref: Ref<HTMLDivElement>
) {
  return <ComponentNode ref={ref} {...props} hideOutputHandles />;
});
