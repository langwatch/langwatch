import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";

export const EVALUATION_STATUSES = [
  "in_progress",
  "processed",
  "error",
  "skipped",
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

const TERMINAL_EVALUATION_STATUSES = new Set<EvaluationStatus>([
  "processed",
  "error",
  "skipped",
]);

export function isTerminalEvaluationStatus(status: EvaluationStatus): boolean {
  return TERMINAL_EVALUATION_STATUSES.has(status);
}

/**
 * The slim per-evaluation dimensions `evaluation_analytics` carries. What an
 * evaluation reports in full — inputs, details, error text — travels on the
 * events and stays in `event_log`; this table has no column for any of it.
 *
 * `startedAt`/`completedAt` are epoch milliseconds where `0` means "not yet",
 * the convention the deployed columns already use.
 */
export const evaluationStateSchema = z.object({
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  status: z.enum(EVALUATION_STATUSES),
  isGuardrail: z.boolean(),
  passed: z.boolean().nullable(),
  score: z.number().nullable(),
  label: z.string().nullable(),
  traceId: z.string().nullable(),
  attributes: z.record(z.string()),
  startedAt: z.number(),
  completedAt: z.number(),
});
export type EvaluationState = z.infer<typeof evaluationStateSchema>;

function initEvaluationState(): EvaluationState {
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
    startedAt: 0,
    completedAt: 0,
  };
}

const evaluationIdentitySchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
  isGuardrail: z.boolean().optional(),
  /** The emitting process's own clock. An aggregate is handed an event's
   * `data` and nothing else, so any timing a fold needs is event-carried. */
  occurredAt: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export const evaluationStartedDataSchema = evaluationIdentitySchema;
export type EvaluationStartedData = z.infer<typeof evaluationStartedDataSchema>;

export const evaluationReportedDataSchema = evaluationIdentitySchema.merge(
  z.object({
    status: z.enum(["processed", "error", "skipped"]),
    score: z.number().nullable().optional(),
    passed: z.boolean().nullable().optional(),
    label: z.string().nullable().optional(),
    details: z.string().nullable().optional(),
    /** The evaluator's raw inputs, or a stored-object offload marker — both
     * are ordinary JSON objects and nothing downstream tells them apart. */
    inputs: z.record(z.unknown()).nullable().optional(),
    error: z.string().nullable().optional(),
    errorDetails: z.string().nullable().optional(),
    costId: z.string().nullable().optional(),
  }),
);
export type EvaluationReportedData = z.infer<
  typeof evaluationReportedDataSchema
>;

/** Scalar metadata values become attribute strings; anything else is dropped. */
function mergeEventMetadata(
  attributes: Record<string, string>,
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!metadata) return attributes;
  let merged = attributes;
  let copied = false;
  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    if (!copied) {
      merged = { ...merged };
      copied = true;
    }
    merged[key] = String(value);
  }
  return merged;
}

/** `min` over every event that named a start, so refining "when did this
 * truly begin" never depends on which event landed first. */
function earliestKnown(current: number, occurredAt: number): number {
  return current > 0 ? Math.min(current, occurredAt) : occurredAt;
}

export function applyEvaluationStarted(
  state: EvaluationState,
  data: EvaluationStartedData,
): EvaluationState {
  const startedAt = earliestKnown(state.startedAt, data.occurredAt);

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
      attributes: mergeEventMetadata(state.attributes, data.metadata),
      startedAt,
    };
  }

  return {
    ...state,
    evaluatorType: data.evaluatorType,
    evaluatorName: data.evaluatorName ?? null,
    traceId: data.traceId ?? null,
    isGuardrail: data.isGuardrail ?? false,
    status: "in_progress",
    startedAt,
    attributes: mergeEventMetadata(state.attributes, data.metadata),
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
    isGuardrail: data.isGuardrail ?? state.isGuardrail,
    status: data.status,
    score: data.score ?? null,
    passed: data.passed ?? null,
    label: data.label ?? null,
    startedAt: earliestKnown(state.startedAt, data.occurredAt),
    completedAt: data.occurredAt,
    attributes: mergeEventMetadata(state.attributes, data.metadata),
  };
}

export const evaluation = defineAggregate({
  name: "evaluation",
  // `lw.evaluation.started` / `lw.evaluation.reported` are already in
  // `event_log`; the prefix is what keeps the derived strings equal to them.
  prefix: "lw",
  state: evaluationStateSchema,
  init: initEvaluationState,
  id: (data) => data.evaluationId,
  events: {
    started: {
      data: evaluationStartedDataSchema,
      apply: applyEvaluationStarted,
    },
    reported: {
      data: evaluationReportedDataSchema,
      apply: applyEvaluationReported,
    },
  },
  commands: {
    start: {
      input: evaluationStartedDataSchema,
      handle: (_state, input, events) => [events.started(input)],
    },
    report: {
      input: evaluationReportedDataSchema,
      handle: (_state, input, events) => [events.reported(input)],
    },
  },
});

export type EvaluationAggregate = typeof evaluation;

export type EvaluationEvent = ReturnType<
  EvaluationAggregate["events"][keyof EvaluationAggregate["events"]]
>;
