import { z } from "zod";

import { runEvaluatorsSchema } from "./scenario-run-evaluators.ts";
import { scenarioEvaluationResultSchema } from "./schemas/event-schemas.ts";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_SET_EVENT_TYPES,
} from "./simulation-event.constants.ts";
import {
  SIMULATION_EVENT_VERDICTS,
  simulationEventMessageSchema,
  simulationEventResultsSchema,
} from "./simulation-event.values.ts";
import { simulationTargetSchema } from "./simulation-target.ts";

const runSecretCiphertextSchema = z.record(z.string(), z.string());

/** Portable event envelope owned by Simulation; Eventing consumes it structurally. */
export const simulationEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});

/**
 * RunQueued event - emitted when a simulation run is scheduled but not yet started.
 */
export const simulationRunQueuedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * The run's secret parameter values, encrypted, keyed by name. A sibling of
   * `metadata`, not a member of it, so an older worker copying `metadata` into
   * the runs store cannot carry it; names ride in clear on `secretParameterNames`.
   */
  secretParameters: runSecretCiphertextSchema.optional(),
  /** Target the event-driven execution runs against. */
  target: simulationTargetSchema.optional(),
  /**
   * The evaluators the run is graded with, resolved from its suite and plan
   * when queued. Absent before this was recorded, and on a code-driven run,
   * which never queues here and resolves evaluators when it finishes instead.
   */
  evaluators: runEvaluatorsSchema.optional(),
});
export type SimulationRunQueuedEventData = z.infer<typeof simulationRunQueuedEventDataSchema>;

export const SimulationRunQueuedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.QUEUED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.QUEUED),
  data: simulationRunQueuedEventDataSchema,
});
export type SimulationRunQueuedEvent = z.infer<typeof SimulationRunQueuedEventSchema>;

/**
 * RunStarted event - emitted when a simulation run begins.
 */
export const simulationRunStartedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SimulationRunStartedEventData = z.infer<typeof simulationRunStartedEventDataSchema>;

export const SimulationRunStartedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.STARTED),
  data: simulationRunStartedEventDataSchema,
});
export type SimulationRunStartedEvent = z.infer<typeof SimulationRunStartedEventSchema>;

/**
 * MessageSnapshot event - emitted when simulation messages are updated.
 */
export const simulationMessageSnapshotEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messages: z.array(simulationEventMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshotEventData = z.infer<
  typeof simulationMessageSnapshotEventDataSchema
>;

export const SimulationMessageSnapshotEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT),
  version: z.literal(SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT),
  data: simulationMessageSnapshotEventDataSchema,
});
export type SimulationMessageSnapshotEvent = z.infer<typeof SimulationMessageSnapshotEventSchema>;

/**
 * RunFinished event - emitted when a simulation run completes.
 */
export const simulationRunFinishedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  results: simulationEventResultsSchema.optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  // Identity + traceIds are event-carried state (ECST) so downstream
  // subscribers never read fold state. Optional because FinishRunCommand
  // backfills them from prior events; not for back-compat, since `version`
  // is pinned to a literal that already rejects an older event.
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  traceIds: z.array(z.string()).optional(),
  /** Target the run executed against, carried forward from its queued event. */
  target: simulationTargetSchema.optional(),
  /**
   * The evaluators the run is graded with, carried forward from its queued
   * event so nothing downstream re-reads the suite or plan. Backfilled live
   * by FinishRunCommand for a run whose events carry none.
   */
  evaluators: runEvaluatorsSchema.optional(),
});
export type SimulationRunFinishedEventData = z.infer<typeof simulationRunFinishedEventDataSchema>;

export const SimulationRunFinishedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.FINISHED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.FINISHED),
  data: simulationRunFinishedEventDataSchema,
});
export type SimulationRunFinishedEvent = z.infer<typeof SimulationRunFinishedEventSchema>;

/** RunEvaluated event after evaluators complete: carries verdict after gate
 * (failing required evaluator flips failure), previous verdict/status as ECST.
 */
export const simulationRunEvaluatedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  evaluations: z.array(scenarioEvaluationResultSchema),
  /** The verdict the run holds now. Absent when the judge never graded it. */
  verdict: z.enum(SIMULATION_EVENT_VERDICTS).optional(),
  /** The status the run reads with now. */
  status: z.string().optional(),
  previousVerdict: z.enum(SIMULATION_EVENT_VERDICTS).optional(),
  previousStatus: z.string().optional(),
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
});
export type SimulationRunEvaluatedEventData = z.infer<typeof simulationRunEvaluatedEventDataSchema>;

export const SimulationRunEvaluatedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.EVALUATED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.EVALUATED),
  data: simulationRunEvaluatedEventDataSchema,
});
export type SimulationRunEvaluatedEvent = z.infer<typeof SimulationRunEvaluatedEventSchema>;

/**
 * TextMessageStart event - emitted when a message begins (placeholder).
 */
export const simulationTextMessageStartEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageStartEventData = z.infer<
  typeof simulationTextMessageStartEventDataSchema
>;

export const SimulationTextMessageStartEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START),
  data: simulationTextMessageStartEventDataSchema,
});
export type SimulationTextMessageStartEvent = z.infer<typeof SimulationTextMessageStartEventSchema>;

/**
 * TextMessageEnd event - emitted when a message is complete with full content.
 */
export const simulationTextMessageEndEventDataSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEndEventData = z.infer<
  typeof simulationTextMessageEndEventDataSchema
>;

export const SimulationTextMessageEndEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END),
  data: simulationTextMessageEndEventDataSchema,
});
export type SimulationTextMessageEndEvent = z.infer<typeof SimulationTextMessageEndEventSchema>;

/**
 * MetricsComputed event - emitted when cost/latency metrics are computed from traces.
 * Carries per-trace metrics via ECST (Event-Carried State Transfer).
 */
export const simulationRunMetricsComputedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  roleCosts: z.record(z.string(), z.number()),
  roleLatencies: z.record(z.string(), z.number()),
});
export type SimulationRunMetricsComputedEventData = z.infer<
  typeof simulationRunMetricsComputedEventDataSchema
>;

export const SimulationRunMetricsComputedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED),
  data: simulationRunMetricsComputedEventDataSchema,
});
export type SimulationRunMetricsComputedEvent = z.infer<
  typeof SimulationRunMetricsComputedEventSchema
>;

/**
 * CancelRequested: sets CancellationRequestedAt in the fold without changing
 * Status. The simulationRunExecution process manager's cancel intent
 * broadcasts this to all worker pods via Redis pub/sub.
 */
export const simulationRunCancelRequestedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunCancelRequestedEventData = z.infer<
  typeof simulationRunCancelRequestedEventDataSchema
>;

export const SimulationRunCancelRequestedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: simulationRunCancelRequestedEventDataSchema,
});
export type SimulationRunCancelRequestedEvent = z.infer<
  typeof SimulationRunCancelRequestedEventSchema
>;

/**
 * AgentInstanceRecorded: the fold writes it into the run's metadata under
 * `langwatch.agentInstance` for the results page. Arrives after the run
 * finished — the child learns the instance and the parent records it on exit.
 */
export const simulationRunAgentInstanceRecordedEventDataSchema = z.object({
  scenarioRunId: z.string(),
  agentInstance: z.object({
    hostname: z.string(),
    label: z.string().nullable(),
  }),
});
export type SimulationRunAgentInstanceRecordedEventData = z.infer<
  typeof simulationRunAgentInstanceRecordedEventDataSchema
>;

export const SimulationRunAgentInstanceRecordedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.AGENT_INSTANCE_RECORDED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.AGENT_INSTANCE_RECORDED),
  data: simulationRunAgentInstanceRecordedEventDataSchema,
});
export type SimulationRunAgentInstanceRecordedEvent = z.infer<
  typeof SimulationRunAgentInstanceRecordedEventSchema
>;

/** CutAtLimitRecorded event after LangWatch ends voice run at max duration;
 * fold sets `isCutAtLimit=true` on metadata, payload carries only run id.
 */
export const simulationRunCutAtLimitRecordedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunCutAtLimitRecordedEventData = z.infer<
  typeof simulationRunCutAtLimitRecordedEventDataSchema
>;

export const SimulationRunCutAtLimitRecordedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CUT_AT_LIMIT_RECORDED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CUT_AT_LIMIT_RECORDED),
  data: simulationRunCutAtLimitRecordedEventDataSchema,
});
export type SimulationRunCutAtLimitRecordedEvent = z.infer<
  typeof SimulationRunCutAtLimitRecordedEventSchema
>;

/**
 * RunDeleted event - emitted when a simulation run is soft-deleted.
 */
export const simulationRunDeletedEventDataSchema = z.object({
  scenarioRunId: z.string(),
});
export type SimulationRunDeletedEventData = z.infer<typeof simulationRunDeletedEventDataSchema>;

export const SimulationRunDeletedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.DELETED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.DELETED),
  data: simulationRunDeletedEventDataSchema,
});
export type SimulationRunDeletedEvent = z.infer<typeof SimulationRunDeletedEventSchema>;

/** SetArchived event: one user intent replaces N deleted events; idempotency
 * on (tenantId, scenarioSetId); runs snapshotted so replay is consistent.
 */
export const simulationSetArchivedEventDataSchema = z.object({
  scenarioSetId: z.string(),
  /**
   * Runs that belonged to the set at archive time. Snapshotted into the
   * payload so replay produces the same projection state regardless of
   * later run inserts/deletes.
   */
  scenarioRunIds: z.array(z.string()).min(1),
});
export type SimulationSetArchivedEventData = z.infer<typeof simulationSetArchivedEventDataSchema>;

export const SimulationSetArchivedEventSchema = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_SET_EVENT_TYPES.ARCHIVED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.SET_ARCHIVED),
  data: simulationSetArchivedEventDataSchema,
});
export type SimulationSetArchivedEvent = z.infer<typeof SimulationSetArchivedEventSchema>;

/**
 * Union of all simulation processing event types.
 */
export type SimulationProcessingEvent =
  | SimulationRunQueuedEvent
  | SimulationRunStartedEvent
  | SimulationMessageSnapshotEvent
  | SimulationTextMessageStartEvent
  | SimulationTextMessageEndEvent
  | SimulationRunFinishedEvent
  | SimulationRunEvaluatedEvent
  | SimulationRunMetricsComputedEvent
  | SimulationRunCancelRequestedEvent
  | SimulationRunAgentInstanceRecordedEvent
  | SimulationRunCutAtLimitRecordedEvent
  | SimulationRunDeletedEvent
  | SimulationSetArchivedEvent;

export {
  isSimulationMessageSnapshotEvent,
  isSimulationRunAgentInstanceRecordedEvent,
  isSimulationRunCancelRequestedEvent,
  isSimulationRunCutAtLimitRecordedEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunEvaluatedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunMetricsComputedEvent,
  isSimulationRunQueuedEvent,
  isSimulationRunStartedEvent,
  isSimulationSetArchivedEvent,
  isSimulationTextMessageEndEvent,
  isSimulationTextMessageStartEvent,
} from "./simulation-event.guards.ts";
