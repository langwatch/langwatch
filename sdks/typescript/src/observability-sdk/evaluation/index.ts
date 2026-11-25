/*
  Manual evaluation recording: the OpenTelemetry-native re-implementation of
  the Python SDK's `add_evaluation`. Parity is by construction — same span
  event name, attribute key and payload keys, so one collector path parses both.
*/

import { type Span, isSpanContextValid } from "@opentelemetry/api";
import { generate as generateKsuid } from "xksuid";

import { ATTR_LANGWATCH_EVALUATION_CUSTOM } from "../semconv/attributes";

/**
 * The status of a recorded evaluation, mirroring the Python
 * `Literal["processed", "skipped", "error"]` accepted by `add_evaluation`.
 */
export type EvaluationStatus = "processed" | "skipped" | "error";

/**
 * Explicit start/finish timestamps for an evaluation, in milliseconds since the
 * Unix epoch (matching how the LangWatch collector expects timestamps). `Date`
 * instances are also accepted and converted.
 */
export interface EvaluationTimestamps {
  /** When the evaluation started. */
  startedAt: Date | number;
  /** When the evaluation finished. */
  finishedAt: Date | number;
}

/**
 * Parameters for {@link LangWatchSpan.addEvaluation}. Only `name` is
 * required; every other field mirrors Python's `add_evaluation` signature
 * and is emitted as `null` when omitted, matching the Python SDK exactly.
 */
export interface AddEvaluationParams {
  /** Human-readable name of the evaluation (required). */
  name: string;
  /** Evaluation type/category (e.g. an evaluator slug). */
  type?: string;
  /**
   * Stable id for this evaluation. Auto-generated (`eval_<ksuid>`) when
   * omitted, mirroring Python's `PKSUID("eval")`.
   */
  evaluationId?: string;
  /** Whether this evaluation acted as a guardrail. */
  isGuardrail?: boolean;
  /** Processing status. Defaults to `"processed"`. */
  status?: EvaluationStatus;
  /** Whether the evaluation passed. */
  passed?: boolean;
  /** Numeric score for the evaluation. */
  score?: number;
  /** Categorical label for the evaluation. */
  label?: string;
  /** Free-form details/explanation. */
  details?: string;
  /** Optional error captured while evaluating. */
  error?: unknown;
  /** Optional explicit start/finish timestamps. */
  timestamps?: EvaluationTimestamps;
}

/**
 * Error shape emitted in the evaluation payload, matching the Python
 * `capture_exception` output (`{ message, stacktrace }`), the
 * runtime-proven collector path.
 */
interface EvaluationErrorCapture {
  message: string;
  stacktrace: string[];
}

/**
 * The JSON payload serialized into the `json_encoded_event` attribute. Keys
 * are snake_case to match the Python `_EvaluationTypedDict`; all keys are
 * always present (`null` for absent values), matching Python's explicit-field behavior.
 */
interface EvaluationEventPayload {
  evaluation_id: string;
  span_id: string | null;
  name: string;
  type: string | null;
  is_guardrail: boolean | null;
  status: EvaluationStatus;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  details: string | null;
  error: EvaluationErrorCapture | null;
  timestamps: { started_at: number | null; finished_at: number | null } | null;
}

function toEpochMillis(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function captureError(error: unknown): EvaluationErrorCapture {
  if (error instanceof Error) {
    return {
      message: String(error),
      stacktrace: error.stack ? error.stack.split("\n") : [],
    };
  }
  return {
    message: String(error),
    stacktrace: [],
  };
}

/**
 * Records a manual evaluation onto `span` as a `langwatch.evaluation.custom` span event.
 * @param span - The OpenTelemetry span to attach the evaluation event to.
 * @param params - The evaluation parameters. See {@link AddEvaluationParams}.
 */
export function emitEvaluationEvent(span: Span, params: AddEvaluationParams): void {
  const spanContext = span.spanContext();
  const spanId = spanContext && isSpanContextValid(spanContext) ? spanContext.spanId : null;

  const payload: EvaluationEventPayload = {
    evaluation_id: params.evaluationId ?? `eval_${generateKsuid()}`,
    span_id: spanId,
    name: params.name,
    type: params.type ?? null,
    is_guardrail: params.isGuardrail ?? null,
    status: params.status ?? "processed",
    passed: params.passed ?? null,
    score: params.score ?? null,
    label: params.label ?? null,
    details: params.details ?? null,
    error: params.error != null ? captureError(params.error) : null,
    timestamps: params.timestamps
      ? {
          started_at: toEpochMillis(params.timestamps.startedAt),
          finished_at: toEpochMillis(params.timestamps.finishedAt),
        }
      : null,
  };

  span.addEvent(ATTR_LANGWATCH_EVALUATION_CUSTOM, {
    json_encoded_event: JSON.stringify(payload),
  });
}
