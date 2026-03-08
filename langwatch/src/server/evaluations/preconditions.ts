import safe from "safe-regex2";
import { createLogger } from "../../utils/logger";
import { extractRAGTextualContext } from "../background/workers/collector/rag";
import type {
  ElasticSearchTrace,
  ErrorCapture,
  LLMSpan,
  RAGSpan,
  Span,
} from "../tracer/types";
import { getEvaluatorDefinitions } from "./getEvaluator";
import type {
  CheckPreconditionFields,
  CheckPreconditionRule,
  CheckPreconditions,
} from "./types";

const logger = createLogger("langwatch:evaluations:preconditions");

/**
 * Trace data required for evaluating preconditions.
 *
 * Backward-compatible: all new fields are optional so the legacy collector
 * path (which passes a full ElasticSearchTrace) continues to work unchanged.
 */
export type PreconditionTrace = Pick<
  ElasticSearchTrace,
  "input" | "output" | "metadata" | "expected_output"
> & {
  /** Trace origin — empty/null/undefined means "application" */
  origin?: string | null;
  /** Trace error — null means no error */
  error?: ErrorCapture | null;
};

/**
 * Resolves the value for a given precondition field from the trace and spans.
 *
 * Returns either a string, a string array, or null/undefined for missing fields.
 * Span-lookup fields return a special marker via the `spans` parameter.
 */
function resolveFieldValue({
  field,
  trace,
  spans,
}: {
  field: CheckPreconditionFields;
  trace: PreconditionTrace;
  spans: Span[];
}): string | string[] | null | undefined {
  switch (field) {
    case "input":
      return trace.input?.value ?? null;
    case "output":
      return trace.output?.value ?? null;
    case "traces.origin":
      // "application" sentinel: empty/null/undefined = "application"
      return trace.origin || "application";
    case "traces.error":
      // Convert error presence to "true"/"false" string
      return trace.error ? "true" : "false";
    case "metadata.labels":
      return trace.metadata?.labels ?? null;
    case "metadata.user_id":
      return trace.metadata?.user_id ?? null;
    case "metadata.thread_id":
      return trace.metadata?.thread_id ?? null;
    case "metadata.customer_id":
      return trace.metadata?.customer_id ?? null;
    case "metadata.prompt_ids":
      return trace.metadata?.prompt_ids ?? null;
    case "spans.type":
      // Collect all span types
      return spans.map((span) => span.type);
    case "spans.model":
      // Collect all span models (LLM spans have .model)
      return spans
        .map((span) => (span as LLMSpan).model)
        .filter((model): model is string => typeof model === "string" && model !== "");
    default: {
      // Exhaustiveness check
      const _exhaustive: never = field;
      return null;
    }
  }
}

/**
 * Evaluates a single precondition rule against a resolved value.
 */
function evaluateRule({
  rule,
  fieldValue,
  conditionValue,
}: {
  rule: CheckPreconditionRule;
  fieldValue: string | string[] | null | undefined;
  conditionValue: string;
}): boolean {
  switch (rule) {
    case "is":
      return evaluateIsRule({ fieldValue, conditionValue });
    case "contains":
      return evaluateContainsRule({ fieldValue, conditionValue });
    case "not_contains":
      return evaluateNotContainsRule({ fieldValue, conditionValue });
    case "matches_regex":
      return evaluateRegexRule({ fieldValue, conditionValue });
    default: {
      const _exhaustive: never = rule;
      return false;
    }
  }
}

/**
 * "is" rule: case-insensitive exact match for strings,
 * membership check for arrays (value is in array).
 */
function evaluateIsRule({
  fieldValue,
  conditionValue,
}: {
  fieldValue: string | string[] | null | undefined;
  conditionValue: string;
}): boolean {
  if (fieldValue == null) return false;

  if (Array.isArray(fieldValue)) {
    return fieldValue.some(
      (item) => item.toLowerCase() === conditionValue.toLowerCase(),
    );
  }

  return fieldValue.toLowerCase() === conditionValue.toLowerCase();
}

/**
 * "contains" rule: substring match for strings,
 * checks if any element contains substring for arrays.
 */
function evaluateContainsRule({
  fieldValue,
  conditionValue,
}: {
  fieldValue: string | string[] | null | undefined;
  conditionValue: string;
}): boolean {
  if (fieldValue == null) return false;

  if (Array.isArray(fieldValue)) {
    return fieldValue.some((item) =>
      item.toLowerCase().includes(conditionValue.toLowerCase()),
    );
  }

  return fieldValue.toLowerCase().includes(conditionValue.toLowerCase());
}

/**
 * "not_contains" rule: inverse of contains.
 * Missing/null values pass (nothing to contain the substring).
 */
function evaluateNotContainsRule({
  fieldValue,
  conditionValue,
}: {
  fieldValue: string | string[] | null | undefined;
  conditionValue: string;
}): boolean {
  if (fieldValue == null) return true;

  if (Array.isArray(fieldValue)) {
    return !fieldValue.some((item) =>
      item.toLowerCase().includes(conditionValue.toLowerCase()),
    );
  }

  return !fieldValue.toLowerCase().includes(conditionValue.toLowerCase());
}

/**
 * "matches_regex" rule: regex test against string values.
 * For arrays, stringifies the array for matching.
 */
function evaluateRegexRule({
  fieldValue,
  conditionValue,
}: {
  fieldValue: string | string[] | null | undefined;
  conditionValue: string;
}): boolean {
  if (fieldValue == null) return false;

  try {
    if (!safe(conditionValue)) {
      throw new Error("Invalid regex");
    }

    const valueToTest = Array.isArray(fieldValue)
      ? JSON.stringify(fieldValue)
      : fieldValue;

    const regex = new RegExp(conditionValue, "gi");
    return regex.test(valueToTest);
  } catch (error) {
    logger.error(
      { error, precondition: conditionValue },
      "Invalid regex in preconditions",
    );
    return false;
  }
}

/**
 * Evaluates all preconditions against a trace and its spans.
 * All preconditions must pass (AND logic) for the evaluation to proceed.
 *
 * Also checks evaluator-specific required fields (contexts, expected_output).
 */
export function evaluatePreconditions(
  evaluatorType: string,
  trace: PreconditionTrace,
  spans: Span[],
  preconditions: CheckPreconditions,
): boolean {
  const evaluator = getEvaluatorDefinitions(evaluatorType);

  if (evaluator?.requiredFields.includes("contexts")) {
    if (
      !spans.some(
        (span) =>
          span.type === "rag" &&
          extractRAGTextualContext((span as RAGSpan).contexts).length > 0,
      )
    ) {
      return false;
    }
  }

  if (evaluator?.requiredFields.includes("expected_output")) {
    if (!trace.expected_output) {
      return false;
    }
  }

  for (const precondition of preconditions) {
    const fieldValue = resolveFieldValue({
      field: precondition.field,
      trace,
      spans,
    });

    const passed = evaluateRule({
      rule: precondition.rule,
      fieldValue,
      conditionValue: precondition.value,
    });

    if (!passed) {
      return false;
    }
  }

  return true;
}
