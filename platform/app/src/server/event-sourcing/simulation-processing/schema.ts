import { z } from "zod";

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

const simulationRunStatusSchema = z.enum(SIMULATION_RUN_STATUSES);

/** The statuses a run may hold once it has a `finishedAt`. */
const TERMINAL_STATUSES = new Set<SimulationRunStatus>([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
]);

export function isTerminalStatus(status: string): status is SimulationRunStatus {
  return TERMINAL_STATUSES.has(status as SimulationRunStatus);
}

/**
 * The status an event asserts, or `undefined` when it asserts none this build
 * recognises. Parsed rather than cast: an unrecognised string reaching the
 * lifecycle ladder ranks below every real status and silently demotes the run.
 */
export function parseStatus(
  value: string | undefined,
): SimulationRunStatus | undefined {
  if (value === undefined) return undefined;
  const parsed = simulationRunStatusSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

const SIMULATION_VERDICTS = ["success", "failure", "inconclusive"] as const;

const simulationResultsSchema = z.object({
  verdict: z.enum(SIMULATION_VERDICTS),
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()).default([]),
  unmetCriteria: z.array(z.string()).default([]),
  error: z.string().optional(),
});

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

/**
 * One row per run and nothing that grows (ADR-103). A run's messages are item
 * rows in `simulation_run_messages`, not an array on this state: an unbounded
 * array here would be rewritten in full on every delivery.
 */
export const simulationRunStateSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  /**
   * How many runs the dispatching batch intended to queue (ADR-103). Every
   * child of a batch carries the same value, so the denominator is available
   * from whichever row lands first. 0 means unknown.
   */
  batchTotal: z.number().int().nonnegative(),
  status: simulationRunStatusSchema,
  name: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.string().nullable(),
  /** A sorted set — every writer unions into it, so delivery order cannot show. */
  traceIds: z.array(z.string()),
  verdict: z.enum(SIMULATION_VERDICTS).nullable(),
  reasoning: z.string().nullable(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  error: z.string().nullable(),
  durationMs: z.number().nullable(),
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
  /** The stamp the winning measurement carried, so a re-measure replaces an
   * older one and an older one never replaces it. */
  metricsAsOf: z.number().nullable(),
  /**
   * The platform's own accept stamp for the row, and the partition anchor. No
   * handler derives it from an event: a value folded out of customer stamps
   * moves, and a moved partition leaves two versions a `ReplacingMergeTree`
   * never collapses. It is written once and read back on every fold.
   */
  startedAt: z.number().nullable(),
  queuedAt: z.number().nullable(),
  /** The earliest instant any of the run's events claims — `0` until one lands. */
  createdAt: z.number(),
  /** The latest instant any of the run's events claims — `0` until one lands. */
  lastEventOccurredAt: z.number(),
  finishedAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  cancellationRequestedAt: z.number().nullable(),
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
    name: null,
    description: null,
    metadata: null,
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
    metricsAsOf: null,
    startedAt: null,
    queuedAt: null,
    createdAt: 0,
    lastEventOccurredAt: 0,
    finishedAt: null,
    archivedAt: null,
    cancellationRequestedAt: null,
  };
}

// `apply(state, event)` dispatches on `{ type, data }` alone — there is no
// envelope timestamp — so every payload a handler derives a time from states
// `occurredAt` itself.

export const runQueuedDataSchema = z.object({
  scenarioRunId: z.string(),
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

export const runStartedDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  occurredAt: z.number(),
});

export const messageSnapshotDataSchema = z.object({
  scenarioRunId: z.string(),
  messages: z.array(simulationMessageInputSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
  occurredAt: z.number(),
});

export const textMessageStartDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().int().nonnegative().optional(),
  occurredAt: z.number(),
});

export const textMessageEndDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
  /** The producer's own numbering, which the transcript orders by. Required:
   * a streamed message that numbers itself `0` by default collides with the
   * snapshot's first message and flips the transcript. */
  messageIndex: z.number().int().nonnegative(),
  occurredAt: z.number(),
});

export const runFinishedDataSchema = z.object({
  scenarioRunId: z.string(),
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  /** Explicit terminal status override, taken verbatim from the event source. */
  status: z.string().optional(),
  occurredAt: z.number(),
});

export const metricsRecordedDataSchema = z.object({
  scenarioRunId: z.string(),
  traceIds: z.array(z.string()),
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
  /** The instant the measurement covers. One measurement replaces another
   * wholesale, so without a stamp two of them settle by arrival order. */
  occurredAt: z.number(),
});

export const cancelRequestedDataSchema = z.object({
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});

export const runDeletedDataSchema = z.object({
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});

export type RunQueuedData = z.infer<typeof runQueuedDataSchema>;
export type RunStartedData = z.infer<typeof runStartedDataSchema>;
export type MessageSnapshotData = z.infer<typeof messageSnapshotDataSchema>;
export type TextMessageStartData = z.infer<typeof textMessageStartDataSchema>;
export type TextMessageEndData = z.infer<typeof textMessageEndDataSchema>;
export type RunFinishedData = z.infer<typeof runFinishedDataSchema>;
export type MetricsRecordedData = z.infer<typeof metricsRecordedDataSchema>;
export type CancelRequestedData = z.infer<typeof cancelRequestedDataSchema>;
export type RunDeletedData = z.infer<typeof runDeletedDataSchema>;
