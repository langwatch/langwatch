import type { Named } from "@langwatch/module";
import { onboardingVariantSchema } from "@langwatch/onboarding-contract";
import { z } from "zod";

import { scenarioEvaluationResultSchema } from "../../schemas/event-schemas.ts";
import { runEvaluatorsSchema } from "../run/scenario-run-evaluators.ts";
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
import { simulationQueuedTargetSchema, simulationTargetSchema } from "./simulation.ts";

const runSecretCiphertextSchema = z.record(z.string(), z.string());

/** Portable event envelope owned by Simulation; Eventing consumes it structurally. */
const simulationEventSchemaDefinition = z.object({
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
export interface SimulationEventSchema extends Named<typeof simulationEventSchemaDefinition> {}
export const simulationEventSchema: SimulationEventSchema = simulationEventSchemaDefinition;

/**
 * RunQueued event - emitted when a simulation run is scheduled but not yet started.
 */
const simulationRunQueuedEventDataSchemaDefinition = z.object({
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
  target: simulationQueuedTargetSchema.optional(),
  /**
   * The evaluators the run is graded with, resolved from its suite and plan
   * when queued. Absent before this was recorded, and on a code-driven run,
   * which never queues here and resolves evaluators when it finishes instead.
   */
  evaluators: runEvaluatorsSchema.optional(),
});
export interface SimulationRunQueuedEventDataSchema extends Named<
  typeof simulationRunQueuedEventDataSchemaDefinition
> {}
export const simulationRunQueuedEventDataSchema: SimulationRunQueuedEventDataSchema =
  simulationRunQueuedEventDataSchemaDefinition;
export type SimulationRunQueuedEventData = z.infer<typeof simulationRunQueuedEventDataSchema>;

const SimulationRunQueuedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.QUEUED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.QUEUED),
  data: simulationRunQueuedEventDataSchema,
});
export interface SimulationRunQueuedEventSchema extends Named<
  typeof SimulationRunQueuedEventSchemaDefinition
> {}
export const SimulationRunQueuedEventSchema: SimulationRunQueuedEventSchema =
  SimulationRunQueuedEventSchemaDefinition;
export type SimulationRunQueuedEvent = z.infer<typeof SimulationRunQueuedEventSchema>;

/**
 * RunStarted event - emitted when a simulation run begins.
 */
const simulationRunStartedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export interface SimulationRunStartedEventDataSchema extends Named<
  typeof simulationRunStartedEventDataSchemaDefinition
> {}
export const simulationRunStartedEventDataSchema: SimulationRunStartedEventDataSchema =
  simulationRunStartedEventDataSchemaDefinition;
export type SimulationRunStartedEventData = z.infer<typeof simulationRunStartedEventDataSchema>;

const SimulationRunStartedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.STARTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.STARTED),
  data: simulationRunStartedEventDataSchema,
});
export interface SimulationRunStartedEventSchema extends Named<
  typeof SimulationRunStartedEventSchemaDefinition
> {}
export const SimulationRunStartedEventSchema: SimulationRunStartedEventSchema =
  SimulationRunStartedEventSchemaDefinition;
export type SimulationRunStartedEvent = z.infer<typeof SimulationRunStartedEventSchema>;

/**
 * MessageSnapshot event - emitted when simulation messages are updated.
 */
const simulationMessageSnapshotEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  messages: z.array(simulationEventMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export interface SimulationMessageSnapshotEventDataSchema extends Named<
  typeof simulationMessageSnapshotEventDataSchemaDefinition
> {}
export const simulationMessageSnapshotEventDataSchema: SimulationMessageSnapshotEventDataSchema =
  simulationMessageSnapshotEventDataSchemaDefinition;
export type SimulationMessageSnapshotEventData = z.infer<
  typeof simulationMessageSnapshotEventDataSchema
>;

const SimulationMessageSnapshotEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT),
  version: z.literal(SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT),
  data: simulationMessageSnapshotEventDataSchema,
});
export interface SimulationMessageSnapshotEventSchema extends Named<
  typeof SimulationMessageSnapshotEventSchemaDefinition
> {}
export const SimulationMessageSnapshotEventSchema: SimulationMessageSnapshotEventSchema =
  SimulationMessageSnapshotEventSchemaDefinition;
export type SimulationMessageSnapshotEvent = z.infer<typeof SimulationMessageSnapshotEventSchema>;

/**
 * RunFinished event - emitted when a simulation run completes.
 */
const simulationRunFinishedEventDataSchemaDefinition = z.object({
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
  /** The organization's admin and onboarding variant, read when a connected agent's run ends. */
  organizationAdmin: z
    .object({
      userId: z.string(),
      onboardingVariant: onboardingVariantSchema.nullish(),
      /** When the organization was created, epoch ms; for days since signup. */
      organizationCreatedAt: z.number().int().nonnegative().nullish(),
    })
    .optional(),
  /** When the run finished, for peers that read only the data (§9); absent on older events. */
  occurredAt: z.number().int().nonnegative().optional(),
});
export interface SimulationRunFinishedEventDataSchema extends Named<
  typeof simulationRunFinishedEventDataSchemaDefinition
> {}
export const simulationRunFinishedEventDataSchema: SimulationRunFinishedEventDataSchema =
  simulationRunFinishedEventDataSchemaDefinition;
export type SimulationRunFinishedEventData = z.infer<typeof simulationRunFinishedEventDataSchema>;

const SimulationRunFinishedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.FINISHED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.FINISHED),
  data: simulationRunFinishedEventDataSchema,
});
export interface SimulationRunFinishedEventSchema extends Named<
  typeof SimulationRunFinishedEventSchemaDefinition
> {}
export const SimulationRunFinishedEventSchema: SimulationRunFinishedEventSchema =
  SimulationRunFinishedEventSchemaDefinition;
export type SimulationRunFinishedEvent = z.infer<typeof SimulationRunFinishedEventSchema>;

/** RunEvaluated event after evaluators complete: carries verdict after gate
 * (failing required evaluator flips failure), previous verdict/status as ECST.
 */
const simulationRunEvaluatedEventDataSchemaDefinition = z.object({
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
export interface SimulationRunEvaluatedEventDataSchema extends Named<
  typeof simulationRunEvaluatedEventDataSchemaDefinition
> {}
export const simulationRunEvaluatedEventDataSchema: SimulationRunEvaluatedEventDataSchema =
  simulationRunEvaluatedEventDataSchemaDefinition;
export type SimulationRunEvaluatedEventData = z.infer<typeof simulationRunEvaluatedEventDataSchema>;

const SimulationRunEvaluatedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.EVALUATED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.EVALUATED),
  data: simulationRunEvaluatedEventDataSchema,
});
export interface SimulationRunEvaluatedEventSchema extends Named<
  typeof SimulationRunEvaluatedEventSchemaDefinition
> {}
export const SimulationRunEvaluatedEventSchema: SimulationRunEvaluatedEventSchema =
  SimulationRunEvaluatedEventSchemaDefinition;
export type SimulationRunEvaluatedEvent = z.infer<typeof SimulationRunEvaluatedEventSchema>;

/**
 * TextMessageStart event - emitted when a message begins (placeholder).
 */
const simulationTextMessageStartEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export interface SimulationTextMessageStartEventDataSchema extends Named<
  typeof simulationTextMessageStartEventDataSchemaDefinition
> {}
export const simulationTextMessageStartEventDataSchema: SimulationTextMessageStartEventDataSchema =
  simulationTextMessageStartEventDataSchemaDefinition;
export type SimulationTextMessageStartEventData = z.infer<
  typeof simulationTextMessageStartEventDataSchema
>;

const SimulationTextMessageStartEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START),
  data: simulationTextMessageStartEventDataSchema,
});
export interface SimulationTextMessageStartEventSchema extends Named<
  typeof SimulationTextMessageStartEventSchemaDefinition
> {}
export const SimulationTextMessageStartEventSchema: SimulationTextMessageStartEventSchema =
  SimulationTextMessageStartEventSchemaDefinition;
export type SimulationTextMessageStartEvent = z.infer<typeof SimulationTextMessageStartEventSchema>;

/**
 * TextMessageEnd event - emitted when a message is complete with full content.
 */
const simulationTextMessageEndEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export interface SimulationTextMessageEndEventDataSchema extends Named<
  typeof simulationTextMessageEndEventDataSchemaDefinition
> {}
export const simulationTextMessageEndEventDataSchema: SimulationTextMessageEndEventDataSchema =
  simulationTextMessageEndEventDataSchemaDefinition;
export type SimulationTextMessageEndEventData = z.infer<
  typeof simulationTextMessageEndEventDataSchema
>;

const SimulationTextMessageEndEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END),
  version: z.literal(SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END),
  data: simulationTextMessageEndEventDataSchema,
});
export interface SimulationTextMessageEndEventSchema extends Named<
  typeof SimulationTextMessageEndEventSchemaDefinition
> {}
export const SimulationTextMessageEndEventSchema: SimulationTextMessageEndEventSchema =
  SimulationTextMessageEndEventSchemaDefinition;
export type SimulationTextMessageEndEvent = z.infer<typeof SimulationTextMessageEndEventSchema>;

/**
 * MetricsComputed event - emitted when cost/latency metrics are computed from traces.
 * Carries per-trace metrics via ECST (Event-Carried State Transfer).
 */
const simulationRunMetricsComputedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  roleCosts: z.record(z.string(), z.number()),
  roleLatencies: z.record(z.string(), z.number()),
});
export interface SimulationRunMetricsComputedEventDataSchema extends Named<
  typeof simulationRunMetricsComputedEventDataSchemaDefinition
> {}
export const simulationRunMetricsComputedEventDataSchema: SimulationRunMetricsComputedEventDataSchema =
  simulationRunMetricsComputedEventDataSchemaDefinition;
export type SimulationRunMetricsComputedEventData = z.infer<
  typeof simulationRunMetricsComputedEventDataSchema
>;

const SimulationRunMetricsComputedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED),
  data: simulationRunMetricsComputedEventDataSchema,
});
export interface SimulationRunMetricsComputedEventSchema extends Named<
  typeof SimulationRunMetricsComputedEventSchemaDefinition
> {}
export const SimulationRunMetricsComputedEventSchema: SimulationRunMetricsComputedEventSchema =
  SimulationRunMetricsComputedEventSchemaDefinition;
export type SimulationRunMetricsComputedEvent = z.infer<
  typeof SimulationRunMetricsComputedEventSchema
>;

/**
 * CancelRequested: sets CancellationRequestedAt in the fold without changing
 * Status. The simulationRunExecution process manager's cancel intent
 * broadcasts this to all worker pods via Redis pub/sub.
 */
const simulationRunCancelRequestedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
});
export interface SimulationRunCancelRequestedEventDataSchema extends Named<
  typeof simulationRunCancelRequestedEventDataSchemaDefinition
> {}
export const simulationRunCancelRequestedEventDataSchema: SimulationRunCancelRequestedEventDataSchema =
  simulationRunCancelRequestedEventDataSchemaDefinition;
export type SimulationRunCancelRequestedEventData = z.infer<
  typeof simulationRunCancelRequestedEventDataSchema
>;

const SimulationRunCancelRequestedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CANCEL_REQUESTED),
  data: simulationRunCancelRequestedEventDataSchema,
});
export interface SimulationRunCancelRequestedEventSchema extends Named<
  typeof SimulationRunCancelRequestedEventSchemaDefinition
> {}
export const SimulationRunCancelRequestedEventSchema: SimulationRunCancelRequestedEventSchema =
  SimulationRunCancelRequestedEventSchemaDefinition;
export type SimulationRunCancelRequestedEvent = z.infer<
  typeof SimulationRunCancelRequestedEventSchema
>;

/**
 * AgentInstanceRecorded: the fold writes it into the run's metadata under
 * `langwatch.agentInstance` for the results page. Arrives after the run
 * finished — the child learns the instance and the parent records it on exit.
 */
const simulationRunAgentInstanceRecordedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  agentInstance: z.object({
    hostname: z.string(),
    label: z.string().nullable(),
  }),
});
export interface SimulationRunAgentInstanceRecordedEventDataSchema extends Named<
  typeof simulationRunAgentInstanceRecordedEventDataSchemaDefinition
> {}
export const simulationRunAgentInstanceRecordedEventDataSchema: SimulationRunAgentInstanceRecordedEventDataSchema =
  simulationRunAgentInstanceRecordedEventDataSchemaDefinition;
export type SimulationRunAgentInstanceRecordedEventData = z.infer<
  typeof simulationRunAgentInstanceRecordedEventDataSchema
>;

const SimulationRunAgentInstanceRecordedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.AGENT_INSTANCE_RECORDED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.AGENT_INSTANCE_RECORDED),
  data: simulationRunAgentInstanceRecordedEventDataSchema,
});
export interface SimulationRunAgentInstanceRecordedEventSchema extends Named<
  typeof SimulationRunAgentInstanceRecordedEventSchemaDefinition
> {}
export const SimulationRunAgentInstanceRecordedEventSchema: SimulationRunAgentInstanceRecordedEventSchema =
  SimulationRunAgentInstanceRecordedEventSchemaDefinition;
export type SimulationRunAgentInstanceRecordedEvent = z.infer<
  typeof SimulationRunAgentInstanceRecordedEventSchema
>;

/** CutAtLimitRecorded event after LangWatch ends voice run at max duration;
 * fold sets `isCutAtLimit=true` on metadata, payload carries only run id.
 */
const simulationRunCutAtLimitRecordedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
});
export interface SimulationRunCutAtLimitRecordedEventDataSchema extends Named<
  typeof simulationRunCutAtLimitRecordedEventDataSchemaDefinition
> {}
export const simulationRunCutAtLimitRecordedEventDataSchema: SimulationRunCutAtLimitRecordedEventDataSchema =
  simulationRunCutAtLimitRecordedEventDataSchemaDefinition;
export type SimulationRunCutAtLimitRecordedEventData = z.infer<
  typeof simulationRunCutAtLimitRecordedEventDataSchema
>;

const SimulationRunCutAtLimitRecordedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.CUT_AT_LIMIT_RECORDED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.CUT_AT_LIMIT_RECORDED),
  data: simulationRunCutAtLimitRecordedEventDataSchema,
});
export interface SimulationRunCutAtLimitRecordedEventSchema extends Named<
  typeof SimulationRunCutAtLimitRecordedEventSchemaDefinition
> {}
export const SimulationRunCutAtLimitRecordedEventSchema: SimulationRunCutAtLimitRecordedEventSchema =
  SimulationRunCutAtLimitRecordedEventSchemaDefinition;
export type SimulationRunCutAtLimitRecordedEvent = z.infer<
  typeof SimulationRunCutAtLimitRecordedEventSchema
>;

/**
 * RunDeleted event - emitted when a simulation run is soft-deleted.
 */
const simulationRunDeletedEventDataSchemaDefinition = z.object({
  scenarioRunId: z.string(),
});
export interface SimulationRunDeletedEventDataSchema extends Named<
  typeof simulationRunDeletedEventDataSchemaDefinition
> {}
export const simulationRunDeletedEventDataSchema: SimulationRunDeletedEventDataSchema =
  simulationRunDeletedEventDataSchemaDefinition;
export type SimulationRunDeletedEventData = z.infer<typeof simulationRunDeletedEventDataSchema>;

const SimulationRunDeletedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_RUN_EVENT_TYPES.DELETED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.DELETED),
  data: simulationRunDeletedEventDataSchema,
});
export interface SimulationRunDeletedEventSchema extends Named<
  typeof SimulationRunDeletedEventSchemaDefinition
> {}
export const SimulationRunDeletedEventSchema: SimulationRunDeletedEventSchema =
  SimulationRunDeletedEventSchemaDefinition;
export type SimulationRunDeletedEvent = z.infer<typeof SimulationRunDeletedEventSchema>;

/** SetArchived event: one user intent replaces N deleted events; idempotency
 * on (tenantId, scenarioSetId); runs snapshotted so replay is consistent.
 */
const simulationSetArchivedEventDataSchemaDefinition = z.object({
  scenarioSetId: z.string(),
  /**
   * Runs that belonged to the set at archive time. Snapshotted into the
   * payload so replay produces the same projection state regardless of
   * later run inserts/deletes.
   */
  scenarioRunIds: z.array(z.string()).min(1),
});
export interface SimulationSetArchivedEventDataSchema extends Named<
  typeof simulationSetArchivedEventDataSchemaDefinition
> {}
export const simulationSetArchivedEventDataSchema: SimulationSetArchivedEventDataSchema =
  simulationSetArchivedEventDataSchemaDefinition;
export type SimulationSetArchivedEventData = z.infer<typeof simulationSetArchivedEventDataSchema>;

const SimulationSetArchivedEventSchemaDefinition = z.object({
  ...simulationEventSchema.shape,
  type: z.literal(SIMULATION_SET_EVENT_TYPES.ARCHIVED),
  version: z.literal(SIMULATION_EVENT_VERSIONS.SET_ARCHIVED),
  data: simulationSetArchivedEventDataSchema,
});
export interface SimulationSetArchivedEventSchema extends Named<
  typeof SimulationSetArchivedEventSchemaDefinition
> {}
export const SimulationSetArchivedEventSchema: SimulationSetArchivedEventSchema =
  SimulationSetArchivedEventSchemaDefinition;
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
