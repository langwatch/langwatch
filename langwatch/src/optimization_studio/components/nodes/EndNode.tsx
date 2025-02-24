import { type Node, type NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import type { End } from "../../types/dsl";
import { ComponentNode } from "./Nodes";

export const EndNode = forwardRef(function EndNode(
  props: NodeProps<Node<End>>,
  ref: Ref<HTMLDivElement>
) {
  return <ComponentNode ref={ref} {...props} inputsTitle="Results" />;
});
