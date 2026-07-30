import { z } from "zod";

/**
 * The `simulation_run` aggregate's state shape, and the event payloads that
 * mutate it (ADR-105).
 *
 * This is a straight carry-over of the old pipeline's
 * `projections/simulationRunState.foldProjection.ts` state shape and
 * `schemas/events.ts` payloads, in camelCase rather than the ClickHouse
 * PascalCase the old single `SimulationRunStateData` type doubled as both
 * fold state AND wire record. ADR-105 replaces the *ceremony* around an event
 * (four declaration sites, a `typeGuards.ts`, a `z.infer` alias file), not
 * the row shape a run actually needs — the shape is domain content, and
 * domain content does not get thinner just because the declaration mechanism
 * around it changed. The wire mapping to ClickHouse's existing column names
 * lives in `store.ts`, not here: this file has never heard of ClickHouse.
 */

// ---------------------------------------------------------------------------
// Status / verdict vocabularies
// ---------------------------------------------------------------------------

/**
 * Status values the run may hold.
 *
 * `QUEUED` is included even though the old pipeline's declared vocabulary
 * (`schemas/shared.ts`) omitted it while its fold wrote it anyway — a
 * divergence ADR-103's Consequences section names explicitly. Closed here
 * rather than carried forward, since a fresh declaration is exactly where a
 * documented, already-diagnosed vocabulary gap is cheap to close.
 *
 * `STALLED` is written by the liveness process that ADR-103 describes
 * (`scenarioExecution`, decision 5) when a run goes quiet — not reproduced in
 * this rewrite (see `index.ts`'s module docblock for what is and is not in
 * scope here).
 */
export const SIMULATION_RUN_STATUSES = [
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
] as const;
export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number];

/** The statuses a run may hold once it has a `finishedAt`. */
const TERMINAL_STATUSES = new Set<SimulationRunStatus>([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
]);

export function isTerminalStatus(
  status: string,
): status is SimulationRunStatus {
  return TERMINAL_STATUSES.has(status as SimulationRunStatus);
}

const SIMULATION_VERDICTS = ["success", "failure", "inconclusive"] as const;
export type SimulationVerdict = (typeof SIMULATION_VERDICTS)[number];

export const simulationResultsSchema = z.object({
  verdict: z.enum(SIMULATION_VERDICTS),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()).default([]),
  unmetCriteria: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type SimulationResults = z.infer<typeof simulationResultsSchema>;

const simulationMessageInputSchema = z
  .object({
    id: z.string().optional(),
    role: z.string().optional(),
    content: z.unknown().optional(),
    trace_id: z.string().optional(),
  })
  .passthrough();

const targetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One stored message row (mirrors `Messages.*` parallel arrays in ClickHouse). */
export const simulationMessageRowSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  traceId: z.string(),
  /** JSON of any remaining AG-UI message fields, or `""`. */
  rest: z.string(),
});
export type SimulationMessageRow = z.infer<typeof simulationMessageRowSchema>;

export const simulationRunStateSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  /**
   * How many runs the dispatching batch intended to queue (ADR-103). Every
   * child of a batch carries the same value, so the batch's denominator is
   * available from whichever row lands first. 0 means unknown.
   */
  batchTotal: z.number().int().nonnegative(),
  status: z.enum(SIMULATION_RUN_STATUSES),
  /**
   * Paired with `status` for terminal-authority comparisons (ADR-098 decision
   * 4: "a monotone-by-rank field with a generation for reruns"). Always 0
   * today — nothing in this rewrite reruns a finished run against its own
   * aggregate id, the same gap ADR-103 names as latent for the old
   * implementation. Carried as a real field, not bolted on later, so the
   * comparison is already `(generation, rank)` and does not need to change
   * shape the day a rerun path is added. See `aggregate.ts`'s
   * `outranksStoredTerminal` for the comparison itself.
   */
  generation: z.number().int().nonnegative(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.string().nullable(),
  messages: z.array(simulationMessageRowSchema),
  traceIds: z.array(z.string()),
  verdict: z.enum(SIMULATION_VERDICTS).nullable(),
  reasoning: z.string().nullable(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  error: z.string().nullable(),
  durationMs: z.number().nullable(),
  /**
   * The run's cost and latency, assigned wholesale from a single
   * `metricsRecorded` event. There is deliberately no per-trace accumulator
   * behind them — every measurement covers all of the run's traces at once,
   * so a re-measure replaces rather than merges.
   */
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
  startedAt: z.number().nullable(),
  queuedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  cancellationRequestedAt: z.number().nullable(),
  /** Guards `messageSnapshot` against an older snapshot applied after a newer one. */
  lastSnapshotOccurredAt: z.number(),
});
export type SimulationRunState = z.infer<typeof simulationRunStateSchema>;

export function initSimulationRunState(): SimulationRunState {
  return {
    scenarioRunId: "",
    scenarioId: "",
    batchRunId: "",
    scenarioSetId: "",
    batchTotal: 0,
    status: "PENDING",
    generation: 0,
    name: null,
    description: null,
    metadata: null,
    messages: [],
    traceIds: [],
    verdict: null,
    reasoning: null,
    metCriteria: [],
    unmetCriteria: [],
    error: null,
    durationMs: null,
    totalCost: null,
    roleCosts: {},
    roleLatencies: {},
    startedAt: null,
    queuedAt: null,
    finishedAt: null,
    archivedAt: null,
    cancellationRequestedAt: null,
    lastSnapshotOccurredAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------
//
// The framework's `apply(state, event)` dispatches on `{ type, data }` alone
// (`@langwatch/event-sourcing`'s `AggregateEvent`) — it carries no envelope
// timestamp. Every payload below that the old fold derived a field from
// `event.occurredAt` therefore states `occurredAt` explicitly; there is no
// free envelope field to reach for instead.

export const runQueuedDataSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  target: targetSchema.optional(),
  batchTotal: z.number().int().nonnegative().optional(),
  occurredAt: z.number(),
});
export type RunQueuedData = z.infer<typeof runQueuedDataSchema>;

export const runStartedDataSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.number(),
});
export type RunStartedData = z.infer<typeof runStartedDataSchema>;

export const messageSnapshotDataSchema = z.object({
  messages: z.array(simulationMessageInputSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type MessageSnapshotData = z.infer<typeof messageSnapshotDataSchema>;

export const textMessageStartDataSchema = z.object({
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
  occurredAt: z.number(),
});
export type TextMessageStartData = z.infer<typeof textMessageStartDataSchema>;

export const textMessageEndDataSchema = z.object({
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
  occurredAt: z.number(),
});
export type TextMessageEndData = z.infer<typeof textMessageEndDataSchema>;

export const runFinishedDataSchema = z.object({
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  /** Explicit terminal status override, taken verbatim from the event source. */
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type RunFinishedData = z.infer<typeof runFinishedDataSchema>;

/**
 * The run's cost/latency, computed once from all of its traces. Carries the
 * whole answer, so the fold assigns rather than accumulates (see
 * `aggregate.ts`'s `metricsRecorded` handler).
 */
export const metricsRecordedDataSchema = z.object({
  traceIds: z.array(z.string()),
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
});
export type MetricsRecordedData = z.infer<typeof metricsRecordedDataSchema>;

export const cancelRequestedDataSchema = z.object({
  occurredAt: z.number(),
});
export type CancelRequestedData = z.infer<typeof cancelRequestedDataSchema>;

export const runDeletedDataSchema = z.object({
  occurredAt: z.number(),
});
export type RunDeletedData = z.infer<typeof runDeletedDataSchema>;
