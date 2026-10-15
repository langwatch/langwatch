import type { CategoricalRead, RangeRead } from "@langwatch/trace-contract";
import { UNSUPPORTED } from "@langwatch/trace-contract";

// ---------------------------------------------------------------------------
// Cross-table in-memory reads (item 4: iterate the referenced collection)
// ---------------------------------------------------------------------------

export const evaluatorStatusRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map((e) => e.status);

// Re-expresses the `evaluatorVerdict` multiIf in JS — `error` and `skipped`
// win, then the 0/1/null `Passed` maps to fail/pass/unknown. Kept in lockstep
// with the SQL expression on the `evaluatorVerdict` facet.
function evaluatorVerdictOf(evaluation: {
  status?: string | null;
  passed?: boolean | null;
}): "error" | "fail" | "pass" | "skipped" | "unknown" {
  if (evaluation.status === "error") return "error";
  if (evaluation.status === "skipped") return "skipped";
  if (evaluation.passed === true) return "pass";
  if (evaluation.passed === false) return "fail";

  return "unknown";
}

export const evaluatorVerdictRead: CategoricalRead = (t) =>
  t.evaluations == null ? UNSUPPORTED : t.evaluations.map(evaluatorVerdictOf);

export const evaluatorScoreRead: RangeRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.flatMap((e) => (e.score == null ? [] : [e.score]));

export const evaluatorLabelRead: CategoricalRead = (t) =>
  t.evaluations == null
    ? UNSUPPORTED
    : t.evaluations.flatMap((e) => (e.label == null ? [] : [e.label]));

export const spanTypeRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => s.attributes["langwatch.span.type"] ?? "");

export const spanNameRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => s.name);

function spanStatusOf(statusCode: number | null | undefined): string {
  if (statusCode === 2) return "error";
  if (statusCode === 1) return "ok";

  return "unset";
}

export const spanStatusRead: CategoricalRead = (t) =>
  t.spans == null ? UNSUPPORTED : t.spans.map((s) => spanStatusOf(s.statusCode));

/** Every filter field name, mirrored by `TraceQueryFieldsService.fieldDefs`' keys. */
export type KnownField =
  | "status"
  | "origin"
  | "service"
  | "model"
  | "user"
  | "conversation"
  | "customer"
  | "scenarioRun"
  | "topic"
  | "subtopic"
  | "traceName"
  | "rootSpanType"
  | "guardrail"
  | "annotation"
  | "containsAi"
  | "errorMessage"
  | "tokensEstimated"
  | "selectedPrompt"
  | "lastUsedPrompt"
  | "promptVersion"
  | "label"
  | "cost"
  | "duration"
  | "tokens"
  | "ttft"
  | "ttlt"
  | "promptTokens"
  | "completionTokens"
  | "tokensPerSecond"
  | "spans"
  | "size"
  | "evaluator"
  | "evaluatorStatus"
  | "evaluatorVerdict"
  | "evaluatorScore"
  | "evaluatorLabel"
  | "spanType"
  | "spanName"
  | "spanStatus"
  | "has"
  | "none"
  | "eval"
  | "eval.trace"
  | "eval.conversation"
  | "eval.llm"
  | "event"
  | "trace"
  | "traceId"
  | "prompt"
  | "spanId"
  | "scenario"
  | "scenarioSet"
  | "scenarioBatch"
  | "scenarioVerdict"
  | "scenarioStatus"
  | "evaluatorPassed";
