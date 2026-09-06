/*
  Manual evaluation recording for the LangWatch observability SDK.

  This is the OpenTelemetry-native re-implementation of the `add_evaluation`
  surface that the Python SDK exposes on both spans and traces
  (`langwatch/telemetry/span.py`, `langwatch/telemetry/tracing.py`) and that the
  Python evaluation module emits from `_add_evaluation`
  (`langwatch/evaluation/__init__.py`).

  Parity is by construction: this module emits the SAME OpenTelemetry span event
  name (`langwatch.evaluation.custom`), the SAME `json_encoded_event` attribute
  key, and the SAME snake_case payload keys as the Python SDK, so the identical
  backend collector path parses both.
*/

import { type Span, isSpanContextValid } from "@opentelemetry/api";
import { generate as generateKsuid } from "xksuid";
import { ATTR_LANGWATCH_EVALUATION_CUSTOM } from "../semconv/attributes";

/**
 * The status of a recorded evaluation.
 *
 * Mirrors the Python `Literal["processed", "skipped", "error"]` accepted by
 * `add_evaluation`.
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
 * Parameters for {@link LangWatchSpan.addEvaluation} / recording a manual
 * evaluation result.
 *
 * The field set is derived from the Python `add_evaluation` signature. Only
 * `name` is required; every other field is optional and, when omitted, is
 * emitted as `null` in the JSON payload to match the Python SDK exactly.
 *
 * @property name - Human-readable name of the evaluation (required).
 * @property type - Evaluation type/category (e.g. an evaluator slug).
 * @property evaluationId - Stable id for this evaluation. Auto-generated
 *   (`eval_<ksuid>`) when omitted, mirroring Python's `PKSUID("eval")`.
 * @property isGuardrail - Whether this evaluation acted as a guardrail.
 * @property status - Processing status. Defaults to `"processed"`.
 * @property passed - Whether the evaluation passed.
 * @property score - Numeric score for the evaluation.
 * @property label - Categorical label for the evaluation.
 * @property details - Free-form details/explanation.
 * @property error - Optional error captured while evaluating.
 * @property timestamps - Optional explicit start/finish timestamps.
 */
export interface AddEvaluationParams {
  name: string;
  type?: string;
  evaluationId?: string;
  isGuardrail?: boolean;
  status?: EvaluationStatus;
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
  error?: unknown;
  timestamps?: EvaluationTimestamps;
}

/**
 * Error shape emitted in the evaluation payload.
 *
 * Matches the Python `capture_exception` output (`{ message, stacktrace }`),
 * which is the runtime-proven collector path.
 */
interface EvaluationErrorCapture {
  message: string;
  stacktrace: string[];
}

/**
 * The JSON payload serialized into the `json_encoded_event` attribute.
 *
 * Keys are snake_case to match the Python `_EvaluationTypedDict` emitted by
 * `_add_evaluation`. All keys are always present (with `null` for absent
 * values), matching the Python behavior where every field is passed explicitly.
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
 * Records a manual evaluation result onto the given OpenTelemetry span by
 * emitting a `langwatch.evaluation.custom` span event whose
 * `json_encoded_event` attribute holds the serialized evaluation payload.
 *
 * This is the shared implementation behind both the span-level and trace-level
 * `addEvaluation` surfaces.
 *
 * @param span - The OpenTelemetry span to attach the evaluation event to.
 * @param params - The evaluation parameters. See {@link AddEvaluationParams}.
 */
export function emitEvaluationEvent(
  span: Span,
  params: AddEvaluationParams,
): void {
  const spanContext = span.spanContext();
  const spanId =
    spanContext && isSpanContextValid(spanContext) ? spanContext.spanId : null;

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
