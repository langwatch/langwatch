import { trimAttributesForAnalytics } from "../analyticsAttributeTrim";
import type {
  EvaluationReportedData,
  EvaluationStartedData,
  EvaluationState,
  EvaluationStatus,
} from "./schema";

const TERMINAL_EVALUATION_STATUSES = new Set<EvaluationStatus>([
  "processed",
  "error",
  "skipped",
]);

function isTerminalEvaluationStatus(status: EvaluationStatus): boolean {
  return TERMINAL_EVALUATION_STATUSES.has(status);
}

export function initEvaluationState(): EvaluationState {
  return {
    evaluatorType: "",
    evaluatorName: null,
    status: "in_progress",
    isGuardrail: false,
    passed: null,
    score: null,
    label: null,
    traceId: null,
    attributes: {},
    occurredAt: 0,
    completedAt: 0,
  };
}

/**
 * Scalar metadata values become attribute strings; anything else is dropped.
 * Trimmed as it enters, not at write time: the state IS the stored row here, so
 * bounding it on the way in is what keeps payload out of the slim table.
 */
function metadataAttributes(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!metadata) return attributes;
  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      attributes[key] = String(value);
    }
  }
  return trimAttributesForAnalytics(attributes);
}

/** `min` over every event, so refining "when did this begin" never depends on
 * which event landed first. */
function earliestKnown(current: number, occurredAt: number): number {
  return current > 0 ? Math.min(current, occurredAt) : occurredAt;
}

export function applyEvaluationStarted(
  state: EvaluationState,
  data: EvaluationStartedData,
): EvaluationState {
  const occurredAt = earliestKnown(state.occurredAt, data.occurredAt);
  // A guardrail stays one however the two events interleave.
  const isGuardrail = state.isGuardrail || (data.isGuardrail ?? false);

  // A `started` event can land after the matching `reported` one — a
  // redelivery, or a race between the SDK's two report phases. Status is
  // monotone by rank over a two-value lattice, so a finished evaluation is
  // never re-counted as running; identity fields the terminal event did not
  // carry may still widen.
  if (isTerminalEvaluationStatus(state.status)) {
    return {
      ...state,
      evaluatorName: state.evaluatorName ?? data.evaluatorName ?? null,
      traceId: state.traceId ?? data.traceId ?? null,
      isGuardrail,
      // The report's attributes outrank a start's, so a start only fills keys
      // the report did not carry.
      attributes: { ...metadataAttributes(data.metadata), ...state.attributes },
      occurredAt,
    };
  }

  return {
    ...state,
    evaluatorType: data.evaluatorType,
    evaluatorName: data.evaluatorName ?? null,
    traceId: data.traceId ?? null,
    isGuardrail,
    status: "in_progress",
    occurredAt,
    attributes: {
      ...state.attributes,
      ...metadataAttributes(data.metadata),
    },
  };
}

export function applyEvaluationReported(
  state: EvaluationState,
  data: EvaluationReportedData,
): EvaluationState {
  return {
    ...state,
    evaluatorType: data.evaluatorType,
    evaluatorName: data.evaluatorName ?? state.evaluatorName ?? null,
    traceId: data.traceId ?? state.traceId ?? null,
    isGuardrail: state.isGuardrail || (data.isGuardrail ?? false),
    status: data.status,
    score: data.score ?? null,
    passed: data.passed ?? null,
    label: data.label ?? null,
    occurredAt: earliestKnown(state.occurredAt, data.occurredAt),
    completedAt: data.occurredAt,
    attributes: {
      ...state.attributes,
      ...metadataAttributes(data.metadata),
    },
  };
}
