import { z } from "zod";

/** The `simulation_run` aggregate's state and event payloads (ADR-105). */

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

/**
 * The run's own facts and nothing that grows (ADR-103). A run's messages are
 * item rows in `simulation_run_messages`, not an array on this state: an
 * unbounded array here would be rewritten in full on every delivery.
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
  status: z.enum(SIMULATION_RUN_STATUSES),
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
  /**
   * Assigned wholesale from one `metricsRecorded` event, never accumulated:
   * every measurement covers all of the run's traces at once, so a re-measure
   * replaces rather than merges.
   */
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
  startedAt: z.number().nullable(),
  queuedAt: z.number().nullable(),
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
    startedAt: null,
    queuedAt: null,
    finishedAt: null,
    archivedAt: null,
    cancellationRequestedAt: null,
  };
}

// `apply(state, event)` dispatches on `{ type, data }` alone — there is no
// envelope timestamp — so every payload that a handler derives a time from
// states `occurredAt` itself.

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
export type RunQueuedData = z.infer<typeof runQueuedDataSchema>;

export const runStartedDataSchema = z.object({
  scenarioRunId: z.string(),
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
  scenarioRunId: z.string(),
  messages: z.array(simulationMessageInputSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type MessageSnapshotData = z.infer<typeof messageSnapshotDataSchema>;

export const textMessageStartDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
  occurredAt: z.number(),
});
export type TextMessageStartData = z.infer<typeof textMessageStartDataSchema>;

export const textMessageEndDataSchema = z.object({
  scenarioRunId: z.string(),
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
  scenarioRunId: z.string(),
  results: simulationResultsSchema.optional(),
  durationMs: z.number().optional(),
  /** Explicit terminal status override, taken verbatim from the event source. */
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type RunFinishedData = z.infer<typeof runFinishedDataSchema>;

export const metricsRecordedDataSchema = z.object({
  scenarioRunId: z.string(),
  traceIds: z.array(z.string()),
  totalCost: z.number().nullable(),
  roleCosts: z.record(z.string(), z.array(z.number())),
  roleLatencies: z.record(z.string(), z.array(z.number())),
});
export type MetricsRecordedData = z.infer<typeof metricsRecordedDataSchema>;

export const cancelRequestedDataSchema = z.object({
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});
export type CancelRequestedData = z.infer<typeof cancelRequestedDataSchema>;

export const runDeletedDataSchema = z.object({
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});
export type RunDeletedData = z.infer<typeof runDeletedDataSchema>;
