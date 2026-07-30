import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";

/**
 * The `evaluation` aggregate (ADR-105): one declaration replaces the old
 * pipeline's `schemas/constants.ts` + `schemas/events.ts` + `schemas/typeGuards.ts`
 * + `commands.ts` — the event type strings, the payload types, the event
 * union, the router's `eventTypes` list and the typed creators are all
 * derived from this, not authored four times over.
 *
 * === What changed from the old pipeline, and why ===
 *
 * The old pipeline declared four event types — `scheduled`, `started`,
 * `completed`, `reported` — but its own comments record that `scheduled` and
 * `completed` are RETIRED: nothing has minted either in production for a
 * while, and they were kept only so the old event log's historical rows keep
 * parsing on replay (`schemas/constants.ts`'s doc comments on
 * `EVALUATION_EVENT_TYPES.SCHEDULED`/`COMPLETED`). This is a greenfield
 * rewrite onto a new event log, not a continuation of the old one (ADR-105's
 * "this rewrite does not attempt to bridge or migrate already-stored rows,
 * which is a whole-system cutover decision outside one pipeline's scope" —
 * see `log-processing/aggregate.ts` for the precedent). So this aggregate
 * declares only the two event types actually still minted today:
 *
 * - `started` — the SDK's two-phase report path records that an evaluation
 *   began (`StartEvaluationCommand` in the old pipeline, still live per
 *   `pipeline.ts`'s own comment: "startEvaluation: Records eval start to CH
 *   (API handler path)").
 * - `reported` — the single atomic terminal fact, used both by the
 *   internally-triggered monitor flow (`executeEvaluation`, one event, no
 *   `started` at all) and by the SDK's second phase.
 *
 * === Defect #2: a finished evaluation must never be re-counted as running ===
 *
 * Delivery order is best effort (ADR-098 decision 4): telemetry and SDK
 * events cross a network before we see them, so a `started` event can arrive
 * AFTER the matching `reported` event — a redelivery, or a genuine race
 * between the two phases of a two-phase SDK report. The old pipeline's
 * `handleEvaluationStarted` set `status: "in_progress"` unconditionally,
 * with no check against the evaluation's current status. A late `started`
 * landing after `reported` would silently flip a finished evaluation back to
 * "in progress" — and any reader counting in-progress evaluations (a
 * timeseries, a live dashboard) would report it as still running forever,
 * because nothing ever re-delivers the terminal fact to correct it.
 *
 * `applyStarted` below closes this the way ADR-098 decision 4 prescribes:
 * status is "monotone by rank" over a two-value lattice — `in_progress` (0)
 * can never overwrite a terminal status (1). This is the same pattern
 * `simulation-processing/aggregate.ts`'s `terminalRank`/`outranksStoredTerminal`
 * uses for run status, applied to the narrower two-value case an evaluation
 * actually has (no distinct "cancelled" outranking "success"; every terminal
 * status here is equally final).
 */

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

/** Whether `status` is a terminal outcome — see the module docblock, defect #2. */
export function isTerminalEvaluationStatus(status: EvaluationStatus): boolean {
  return TERMINAL_EVALUATION_STATUSES.has(status);
}

export const evaluationStateSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  traceId: z.string().nullable(),
  isGuardrail: z.boolean(),
  status: z.enum(EVALUATION_STATUSES),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  /**
   * May hold the evaluator's raw inputs OR a stored-object offload marker
   * (ADR-098 decision 8) — this aggregate never distinguishes the two. A
   * marker is "a valid JSON object", so it round-trips through this
   * `z.record(z.unknown())` field exactly like real inputs would; resolving
   * it back to full content happens only at an API read boundary, never in
   * this fold, or the fat payload re-inlines on the next re-fold and defeats
   * the bound the offload exists to enforce. See `services/executeEvaluation.ts`.
   */
  inputs: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  errorDetails: z.string().nullable(),
  costId: z.string().nullable(),
  startedAtMs: z.number().nullable(),
  completedAtMs: z.number().nullable(),
  /** Merged, string-coerced event metadata. See `applyStarted`/`applyReported`. */
  attributes: z.record(z.string()),
});
export type EvaluationState = z.infer<typeof evaluationStateSchema>;

function initEvaluationState(): EvaluationState {
  return {
    evaluationId: "",
    evaluatorId: "",
    evaluatorType: "",
    evaluatorName: null,
    traceId: null,
    isGuardrail: false,
    status: "in_progress",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    costId: null,
    startedAtMs: null,
    completedAtMs: null,
    attributes: {},
  };
}

const evaluationIdentitySchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
  isGuardrail: z.boolean().optional(),
  /**
   * When this event happened, on the emitting process's own clock. This
   * aggregate has no implicit envelope access (`defineAggregate`'s `apply`
   * receives only an event's `data`, never `occurredAt`/`acceptedAt`/`id` —
   * see `log-processing/aggregate.ts`'s docblock for the same observation
   * against the ADR's illustrative example), so any timing the fold needs
   * must be explicit, event-carried data.
   */
  occurredAt: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export const evaluationStartedDataSchema = evaluationIdentitySchema;
export type EvaluationStartedData = z.infer<typeof evaluationStartedDataSchema>;

const evaluationResultSchema = z.object({
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
});

export const evaluationReportedDataSchema = evaluationIdentitySchema.merge(
  evaluationResultSchema,
);
export type EvaluationReportedData = z.infer<
  typeof evaluationReportedDataSchema
>;

/** Coerces scalar metadata values to strings; drops anything else. Kept
 * deliberately simple — the full `trimAttributesForAnalytics` policy (byte
 * caps, reserved-key handling) lives in `trace-processing`, and this rewrite
 * does not reach into `event-sourcing.old` to borrow it (that tree is
 * read-only reference, on its way out as each pipeline converts). A future
 * shared trim utility belongs in a package both pipelines can depend on. */
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

/**
 * Applies a "started" event — see the module docblock's "Defect #2" section
 * for why the terminal branch exists.
 */
/**
 * The earliest known start time. Commutative and associative (ADR-098
 * decision 4, category 1 — `min`), so it is safe to fold in ANY order and
 * in ANY status, terminal included: refining "when did this truly start"
 * never changes an outcome, only a display timestamp. This is what both
 * `applyStarted` and `applyReported` call — each may be the one that first
 * backfills it (an atomic `reported` with no prior `started` backfills from
 * its own `occurredAt`), and whichever one turns out to carry the genuinely
 * earlier value wins regardless of which arrived first. A first attempt at
 * this fold used `state.startedAtMs ?? data.occurredAt` — fills once,
 * never revises — which is NOT order-invariant: `checkOrderInvariance`
 * caught it, because "reported-then-late-started" backfilled from the
 * report's own (later) time and then the late `started` event's terminal
 * branch left it there, while "started-then-reported" kept the true
 * (earlier) start time — two different values for the same two events.
 */
function earliestKnown(current: number | null, occurredAt: number): number {
  return current !== null ? Math.min(current, occurredAt) : occurredAt;
}

function applyStarted(
  state: EvaluationState,
  data: EvaluationStartedData,
): EvaluationState {
  const startedAtMs = earliestKnown(state.startedAtMs, data.occurredAt);

  if (isTerminalEvaluationStatus(state.status)) {
    // Already finished. A late `started` may still widen identity fields
    // the terminal event did not carry and refine `startedAtMs`, but must
    // never move `status` backward — that is the entire guard.
    return {
      ...state,
      evaluatorName: state.evaluatorName ?? data.evaluatorName ?? null,
      traceId: state.traceId ?? data.traceId ?? null,
      attributes: mergeEventMetadata(state.attributes, data.metadata),
      startedAtMs,
    };
  }
  return {
    ...state,
    evaluationId: data.evaluationId,
    evaluatorId: data.evaluatorId,
    evaluatorType: data.evaluatorType,
    evaluatorName: data.evaluatorName ?? null,
    traceId: data.traceId ?? null,
    isGuardrail: data.isGuardrail ?? false,
    status: "in_progress",
    startedAtMs,
    attributes: mergeEventMetadata(state.attributes, data.metadata),
  };
}

/**
 * Applies a "reported" event — the terminal fact. Always wins on `status`:
 * `reported` IS the terminal declaration, so there is no rank to check
 * against (unlike `started`, which must defer to an existing terminal
 * status). `startedAtMs` still goes through {@link earliestKnown} — see its
 * docblock for why an unconditional `??` backfill is not order-invariant.
 */
function applyReported(
  state: EvaluationState,
  data: EvaluationReportedData,
): EvaluationState {
  return {
    ...state,
    evaluationId: data.evaluationId,
    evaluatorId: data.evaluatorId,
    evaluatorType: data.evaluatorType,
    evaluatorName: data.evaluatorName ?? state.evaluatorName ?? null,
    traceId: data.traceId ?? state.traceId ?? null,
    isGuardrail: data.isGuardrail ?? state.isGuardrail,
    status: data.status,
    score: data.score ?? null,
    passed: data.passed ?? null,
    label: data.label ?? null,
    details: data.details ?? null,
    inputs: data.inputs ?? null,
    error: data.error ?? null,
    errorDetails: data.errorDetails ?? null,
    costId: data.costId ?? null,
    startedAtMs: earliestKnown(state.startedAtMs, data.occurredAt),
    completedAtMs: data.occurredAt,
    attributes: mergeEventMetadata(state.attributes, data.metadata),
  };
}

export const evaluationAggregate = defineAggregate("evaluation")
  .state(evaluationStateSchema, initEvaluationState)
  .events({
    started: { data: evaluationStartedDataSchema, apply: applyStarted },
    reported: { data: evaluationReportedDataSchema, apply: applyReported },
  })
  .commands({
    /** The pure half of the old `StartEvaluationCommand` — schema validation
     * plus event construction, nothing else to decide. */
    start: {
      input: evaluationStartedDataSchema,
      handle: (_state, input, events) => [events.started(input)],
    },
    /** The pure half of the old `ReportEvaluationCommand`, and also what the
     * `executeEvaluation` orchestration (`services/executeEvaluation.ts`)
     * calls once it has already decided the outcome — see that module for
     * why the orchestration itself cannot be one of these commands
     * (`CommandDef.handle` is synchronous and pure; fetching a monitor,
     * running an evaluator and recording cost are none of those things). */
    report: {
      input: evaluationReportedDataSchema,
      handle: (_state, input, events) => [events.reported(input)],
    },
  })
  .build();

export type EvaluationAggregate = typeof evaluationAggregate;

/** The union of every event this aggregate can produce, derived rather than
 * hand-declared — see `defineAggregate.unit.test.ts` upstream for the same
 * pattern this mirrors. */
export type EvaluationEvent = ReturnType<
  EvaluationAggregate["events"][keyof EvaluationAggregate["events"]]
>;
