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
  "list[float]",
  "list[int]",
  "list[bool]",
  "dict",
] as const;
export type LlmConfigInputType = (typeof LlmConfigInputTypes)[number];

export const LlmConfigOutputTypes = [
  "str",
  "float",
  "bool",
  "json_schema",
] as const;
export type LlmConfigOutputType = (typeof LlmConfigOutputTypes)[number];
