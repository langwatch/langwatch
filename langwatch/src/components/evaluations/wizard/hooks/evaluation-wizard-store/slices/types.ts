import type { Component } from "~/optimization_studio/types/dsl";
import type { XYPosition, Node } from "@xyflow/react";

export type NodeWithOptionalPosition<T extends Component> = Omit<
  Node<T>,
  "position"
> & {
  position?: XYPosition;
};
