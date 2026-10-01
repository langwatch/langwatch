/** The shapes a variable-mapping picker offers and records, shared across modules. */
import type { ComponentType, Field } from "./studio-workflow.ts";

/** Source types aligned with DSL ComponentType + dataset */
export type SourceType = ComponentType | "dataset";

/** Field type - uses DSL Field type for strong typing */
export type FieldType = Field["type"];

/**
 * A field selectable in the mapping dropdown, supporting nested fields via
 * `children` (static array or dynamic `getChildren()`).
 */
export type NestedField = {
  /** Field name (used as path segment) */
  name: string;
  /** Display label (defaults to name if not provided) */
  label?: string;
  /** Field type for display */
  type: FieldType;
  /**
   * Static children - use when children are known at definition time.
   * Example: spans always have input/output/params subfields.
   */
  children?: NestedField[];
  /**
   * Dynamic children - use when children depend on runtime data.
   * Example: metadata keys depend on actual trace data.
   * The function is called when the field is selected to populate nested options.
   */
  getChildren?: () => NestedField[];
  /**
   * Whether selecting this field is "complete" without drilling down.
   * Defaults to false when it has children; override to allow a parent
   * like "spans" to be selected whole OR drilled into.
   */
  isComplete?: boolean;
  /**
   * Custom label for the "Use all X" option when isComplete is true and field has children.
   * Defaults to "Use all {fieldName}" if not provided.
   */
  isCompleteLabel?: string;
};

export type AvailableSource = {
  id: string;
  name: string;
  type: SourceType;
  /** Fields available for mapping. Supports nested fields via children. */
  fields: NestedField[];
};

/**
 * Field mapping - either to a source field or a hardcoded value. For
 * source mappings, `path` is an array of field segments (e.g.
 * `["spans", "gpt-4", "output"]`).
 */
export type FieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };
