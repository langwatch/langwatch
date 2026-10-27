/** A mapping picker's shapes, restated structurally so the design system needs no contract. */

/** Where a mappable value comes from: a dataset, or a workflow node of this kind. */
export type SourceType =
  | "dataset"
  | "entry"
  | "end"
  | "signature"
  | "code"
  | "retriever"
  | "prompting_technique"
  | "custom"
  | "evaluator"
  | "http"
  | "agent"
  | "if_else";

/** A variable's value type, as the workflow engine names it. */
export type FieldType =
  | "str"
  | "image"
  | "file"
  | "float"
  | "int"
  | "bool"
  | "list"
  | "list[str]"
  | "list[float]"
  | "list[int]"
  | "list[bool]"
  | "dict"
  | "json_schema"
  | "chat_messages"
  | "signature"
  | "llm"
  | "prompting_technique"
  | "dataset"
  | "code";

/** A field the picker offers; `children` or `getChildren()` lets the user drill in. */
export type NestedField = {
  name: string;
  /** Display label; the name when absent. */
  label?: string;
  type: FieldType;
  children?: NestedField[];
  /** Children known only at runtime, read when the field is selected. */
  getChildren?: () => NestedField[];
  /** Selecting the field is enough without drilling down (false when it has children). */
  isComplete?: boolean;
  /** The "Use all X" label when `isComplete` and it has children. */
  isCompleteLabel?: string;
};

export type AvailableSource = {
  id: string;
  name: string;
  type: SourceType;
  fields: NestedField[];
};

/** A source field by path (e.g. `["spans", "gpt-4", "output"]`) or a fixed value. */
export type FieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };
