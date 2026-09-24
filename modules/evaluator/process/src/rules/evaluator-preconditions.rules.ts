import {
  normalizePreconditionTraceData,
  PRECONDITION_FIELD_MATCHERS,
  type PreconditionTraceData,
} from "@langwatch/analytics-contract";
import { getEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import type {
  CheckPreconditionRule,
  CheckPreconditions,
} from "@langwatch/evaluator-contract/evaluation-types";
import { extractRAGTextualContext, type Span } from "@langwatch/trace-contract";
import safe from "safe-regex2";

type FieldValue = string | string[] | null | undefined;

function isMatchableField(field: string): field is keyof typeof PRECONDITION_FIELD_MATCHERS {
  return Object.hasOwn(PRECONDITION_FIELD_MATCHERS, field);
}

function anyValue(fieldValue: string | string[], test: (value: string) => boolean): boolean {
  return Array.isArray(fieldValue) ? fieldValue.some(test) : test(fieldValue);
}

/** Case-insensitive; an array passes on any element. Absent fails all but `not_contains`. */
function evaluateRule({
  rule,
  fieldValue,
  conditionValue,
}: {
  rule: CheckPreconditionRule;
  fieldValue: FieldValue;
  conditionValue: string;
}): boolean {
  const condition = conditionValue.toLowerCase();
  switch (rule) {
    case "is":
      return fieldValue != null && anyValue(fieldValue, (item) => item.toLowerCase() === condition);
    case "contains":
      return (
        fieldValue != null && anyValue(fieldValue, (item) => item.toLowerCase().includes(condition))
      );
    case "not_contains":
      return (
        fieldValue == null ||
        !anyValue(fieldValue, (item) => item.toLowerCase().includes(condition))
      );
    case "matches_regex":
      return evaluateRegexRule({ fieldValue, conditionValue });
    default: {
      const _exhaustive: never = rule;
      return false;
    }
  }
}

/** Arrays also test their serialized form, so patterns for the old JSON form still match. */
function evaluateRegexRule({
  fieldValue,
  conditionValue,
}: {
  fieldValue: FieldValue;
  conditionValue: string;
}): boolean {
  if (fieldValue == null || !safe(conditionValue)) return false;

  const valuesToTest = Array.isArray(fieldValue)
    ? [...fieldValue, JSON.stringify(fieldValue)]
    : [fieldValue];
  try {
    return valuesToTest.some((value) => new RegExp(conditionValue, "gi").test(value));
  } catch {
    return false;
  }
}

/** The evaluator's own required inputs (contexts, expected_output), apart from any precondition. */
export function checkEvaluatorRequiredFields({
  evaluatorType,
  spans,
  expectedOutput,
}: {
  evaluatorType: string;
  spans: readonly Span[];
  expectedOutput?: { value: string } | null;
}): boolean {
  const evaluator = getEvaluatorDefinitions(evaluatorType);
  const hasContexts = spans.some(
    (span) =>
      span.type === "rag" &&
      "contexts" in span &&
      extractRAGTextualContext(span.contexts).length > 0,
  );
  if (evaluator?.requiredFields.includes("contexts") && !hasContexts) return false;
  if (evaluator?.requiredFields.includes("expected_output") && !expectedOutput) return false;

  return true;
}

/** Every precondition must pass (AND). */
export function evaluatePreconditions({
  traceData,
  preconditions,
}: {
  traceData: PreconditionTraceData;
  preconditions: CheckPreconditions;
}): boolean {
  const normalizedData = normalizePreconditionTraceData(traceData);

  return preconditions.every((precondition) =>
    evaluateRule({
      rule: precondition.rule,
      fieldValue: isMatchableField(precondition.field)
        ? PRECONDITION_FIELD_MATCHERS[precondition.field]?.(
            normalizedData,
            precondition.value,
            precondition.key,
            precondition.subkey,
          )
        : undefined,
      conditionValue: precondition.value,
    }),
  );
}
