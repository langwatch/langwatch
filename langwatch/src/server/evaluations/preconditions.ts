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
import {
  PRECONDITION_FIELD_MATCHERS,
  type PreconditionTraceData,
} from "../filters/precondition-matchers";
import { getEvaluatorDefinitions } from "./getEvaluator";
import type {
  CheckPreconditionRule,
  CheckPreconditions,
} from "./types";
import type { ExecuteEvaluationCommandData } from "../event-sourcing/pipelines/evaluation-processing/schemas/commands";

export type { PreconditionTraceData } from "../filters/precondition-matchers";

const logger = createLogger("langwatch:evaluations:preconditions");

// ---------------------------------------------------------------------------
// Field value resolution via matcher registry
// ---------------------------------------------------------------------------

/**
 * Resolves the value for a given precondition field from trace data
 * using the matcher registry.
 */
function resolveFieldValue({
  field,
  data,
  key,
  subkey,
  value,
}: {
  field: string;
  data: PreconditionTraceData;
  key?: string;
  subkey?: string;
  value: string;
}): string | string[] | null | undefined {
  const matcher =
    PRECONDITION_FIELD_MATCHERS[
      field as keyof typeof PRECONDITION_FIELD_MATCHERS
    ];

  if (matcher == null) {
    // Key-selector or unavailable field — not matchable
    return null;
  }

  return matcher(data, value, key, subkey);
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Evaluator required-field checks
// ---------------------------------------------------------------------------

/**
 * Checks evaluator-specific required fields (contexts, expected_output).
 * This is separate from precondition evaluation because it's about evaluator
 * requirements, not user-configured precondition rules.
 */
export function checkEvaluatorRequiredFields({
  evaluatorType,
  spans,
  expectedOutput,
}: {
  evaluatorType: string;
  spans: Span[];
  expectedOutput?: { value: string } | null;
}): boolean {
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
    if (!expectedOutput) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluates all preconditions against trace data.
 * All preconditions must pass (AND logic) for the evaluation to proceed.
 */
export function evaluatePreconditions({
  traceData,
  preconditions,
}: {
  traceData: PreconditionTraceData;
  preconditions: CheckPreconditions;
}): boolean {
  for (const precondition of preconditions) {
    const fieldValue = resolveFieldValue({
      field: precondition.field,
      data: traceData,
      key: precondition.key,
      subkey: precondition.subkey,
      value: precondition.value,
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

/**
 * Check if any preconditions reference event fields, requiring an
 * additional trace fetch to get event data.
 */
export function preconditionsNeedEvents(
  preconditions: CheckPreconditions,
): boolean {
  return preconditions.some((p) => p.field.startsWith("events."));
}

// ---------------------------------------------------------------------------
// Builder helpers — create PreconditionTraceData from different sources
// ---------------------------------------------------------------------------

/**
 * Build PreconditionTraceData from a legacy collector trace + spans.
 */
export function buildPreconditionTraceDataFromTrace({
  trace,
  spans,
  events,
}: {
  trace: {
    input?: { value: string } | null;
    output?: { value: string } | null;
    metadata?: ElasticSearchTrace["metadata"];
    expected_output?: { value: string } | null;
    origin?: string | null;
    error?: ErrorCapture | null;
  };
  spans: Span[];
  events?: ElasticSearchTrace["events"];
}): PreconditionTraceData {
  const customMetadata: Record<string, string | null> = {};
  if (trace.metadata?.custom) {
    for (const [key, val] of Object.entries(trace.metadata.custom)) {
      customMetadata[key] = val != null ? String(val) : null;
    }
  }

  return {
    input: trace.input?.value ?? null,
    output: trace.output?.value ?? null,
    origin: trace.origin ?? null,
    hasError: trace.error ? true : false,
    userId: trace.metadata?.user_id ?? null,
    threadId: trace.metadata?.thread_id ?? null,
    customerId: trace.metadata?.customer_id ?? null,
    labels: trace.metadata?.labels ?? null,
    promptIds: trace.metadata?.prompt_ids ?? null,
    topicId: trace.metadata?.topic_id ?? null,
    subTopicId: trace.metadata?.subtopic_id ?? null,
    spanTypes: spans.map((span) => span.type),
    spanModels: spans
      .map((span) => (span as LLMSpan).model)
      .filter((model): model is string => typeof model === "string" && model !== ""),
    customMetadata: Object.keys(customMetadata).length > 0 ? customMetadata : null,
    annotationIds: [], // Not available in legacy collector path
    events: events?.map((e) => ({
      event_type: e.event_type,
      metrics: e.metrics ?? [],
      event_details: e.event_details ?? [],
    })) ?? null,
  };
}

/**
 * Build PreconditionTraceData from event-sourcing command data + spans.
 */
export function buildPreconditionTraceDataFromCommand({
  data,
  spans,
  events,
}: {
  data: ExecuteEvaluationCommandData;
  spans: Span[];
  events?: PreconditionTraceData["events"];
}): PreconditionTraceData {
  return {
    input: data.computedInput ?? null,
    output: data.computedOutput ?? null,
    origin: data.origin ?? null,
    hasError: data.hasError ?? false,
    userId: data.userId ?? null,
    threadId: data.threadId ?? null,
    customerId: data.customerId ?? null,
    labels: data.labels ?? null,
    promptIds: data.promptIds ?? null,
    topicId: data.topicId ?? null,
    subTopicId: data.subTopicId ?? null,
    spanTypes: data.spanTypes ?? spans.map((span) => span.type),
    spanModels:
      data.spanModels ??
      spans
        .map((span) => (span as LLMSpan).model)
        .filter(
          (model): model is string =>
            typeof model === "string" && model !== "",
        ),
    customMetadata: data.customMetadata ?? null,
    annotationIds: [], // Not available at command time
    events: events ?? null,
  };
}
