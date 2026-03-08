import { z } from "zod";
import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "./evaluators.generated";

export type CheckPreconditionRule =
  | "contains"
  | "not_contains"
  | "matches_regex"
  | "is";

export type CheckPreconditionFields =
  | "input"
  | "output"
  | "traces.origin"
  | "traces.error"
  | "metadata.labels"
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.prompt_ids"
  | "spans.type"
  | "spans.model";

export type CheckPrecondition = {
  field: CheckPreconditionFields;
  rule: CheckPreconditionRule;
  /**
   * @minLength 1
   * @maxLength 500
   */
  value: string;
};

export type CheckPreconditions = CheckPrecondition[];

/**
 * Field value type determines how precondition matching works.
 * - text: string comparison (contains, not_contains, matches_regex, is)
 * - enum: exact match only (is)
 * - boolean: "true"/"false" string matched against boolean presence (is)
 * - array: value-in-array for "is"; substring-in-any-element for contains/not_contains
 * - span-lookup: "is" with ANY semantics across spans
 */
type PreconditionValueType =
  | "text"
  | "enum"
  | "boolean"
  | "array"
  | "span-lookup";

type PreconditionCategory = "Trace" | "Metadata" | "Spans";

export interface PreconditionFieldConfig {
  category: PreconditionCategory;
  allowedRules: CheckPreconditionRule[];
  valueType: PreconditionValueType;
  label: string;
}

/**
 * Registry mapping each precondition field to its configuration.
 * This is the single source of truth for field metadata used by both
 * the backend (rule validation) and frontend (UI rendering).
 */
export const PRECONDITION_FIELD_CONFIG: Record<
  CheckPreconditionFields,
  PreconditionFieldConfig
> = {
  input: {
    category: "Trace",
    allowedRules: ["contains", "not_contains", "matches_regex", "is"],
    valueType: "text",
    label: "Input",
  },
  output: {
    category: "Trace",
    allowedRules: ["contains", "not_contains", "matches_regex", "is"],
    valueType: "text",
    label: "Output",
  },
  "traces.origin": {
    category: "Trace",
    allowedRules: ["is"],
    valueType: "enum",
    label: "Origin",
  },
  "traces.error": {
    category: "Trace",
    allowedRules: ["is"],
    valueType: "boolean",
    label: "Has Error",
  },
  "metadata.labels": {
    category: "Metadata",
    allowedRules: ["is", "contains", "not_contains"],
    valueType: "array",
    label: "Labels",
  },
  "metadata.user_id": {
    category: "Metadata",
    allowedRules: ["contains", "not_contains", "matches_regex", "is"],
    valueType: "text",
    label: "User ID",
  },
  "metadata.thread_id": {
    category: "Metadata",
    allowedRules: ["contains", "not_contains", "matches_regex", "is"],
    valueType: "text",
    label: "Thread ID",
  },
  "metadata.customer_id": {
    category: "Metadata",
    allowedRules: ["contains", "not_contains", "matches_regex", "is"],
    valueType: "text",
    label: "Customer ID",
  },
  "metadata.prompt_ids": {
    category: "Metadata",
    allowedRules: ["is", "contains", "not_contains"],
    valueType: "array",
    label: "Prompt IDs",
  },
  "spans.type": {
    category: "Spans",
    allowedRules: ["is"],
    valueType: "span-lookup",
    label: "Span Type",
  },
  "spans.model": {
    category: "Spans",
    allowedRules: ["is"],
    valueType: "span-lookup",
    label: "Model",
  },
};

export type Conversation = {
  input?: string;
  output?: string;
}[];

export const evaluationInputSchema = z.object({
  trace_id: z.string().optional().nullable(),
  evaluation_id: z.string().optional().nullable(),
  evaluator_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  data: z.object({}).passthrough().optional().nullable(),
  settings: z.object({}).passthrough().optional().nullable(),
  as_guardrail: z.boolean().optional().nullable().default(false),
});

export type EvaluationRESTParams = z.infer<typeof evaluationInputSchema>;

export type EvaluationRESTResult = (
  | EvaluationResult
  | EvaluationResultSkipped
  | Omit<EvaluationResultError, "traceback">
) & {
  passed?: boolean;
};
