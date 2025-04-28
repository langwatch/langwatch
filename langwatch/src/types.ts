import type { Component } from "~/optimization_studio/types/dsl";
import type { XYPosition, Node } from "@xyflow/react";

export type NodeWithOptionalPosition<T extends Component> = Omit<
  Node<T>,
  "position"
> & {
  position?: XYPosition;
};

export const LlmConfigInputTypes = [
  "str",
  "float",
  "bool",
  "image",
  "list[str]",
] as const;
export type LlmConfigInputType = (typeof LlmConfigInputTypes)[number];

export const LlmConfigOutputTypes = ["str", "float", "bool"] as const;
export type LlmConfigOutputType = (typeof LlmConfigOutputTypes)[number];
