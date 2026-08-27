import { z } from "zod";
import { runSecretCiphertextSchema } from "@langwatch/scenario-contract";
import {
  simulationEventMessageSchema as simulationMessageSchema,
  simulationEventResultsSchema as simulationResultsSchema,
} from "@langwatch/simulation-contract";

export const queueRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * The run's secret parameter values, encrypted, keyed by name. A sibling of
   * `metadata` so the fold projection cannot copy it into the runs store.
   */
  secretParameters: runSecretCiphertextSchema.optional(),
  /** Target for execution. Used by the process manager's execute intent to spawn the right adapter. */
  target: z
    .object({
      type: z.enum(["prompt", "http", "code", "workflow"]),
      referenceId: z.string(),
    })
    .optional(),
  occurredAt: z.number(),
});
export type QueueRunCommandData = z.infer<typeof queueRunCommandDataSchema>;

export const startRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.number(),
});
export type StartRunCommandData = z.infer<typeof startRunCommandDataSchema>;

export const messageSnapshotCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
  occurredAt: z.number(),
});
export type MessageSnapshotCommandData = z.infer<typeof messageSnapshotCommandDataSchema>;

export const finishRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  results: simulationResultsSchema.optional(),
  /**
   * Failure reason from infrastructure callers (the stall watchdog and
   * cancel-grace intents) that have no judge verdict to report. When
   * `results` is absent, FinishRunCommand synthesizes the failure-results
   * envelope from this so the reason is recorded on the event instead of
   * being dropped at the schema boundary. Ignored when `results` is given.
   */
  error: z.string().optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  /**
   * ECST fields for the RunFinished event. Optional: FinishRunCommand
   * backfills any gap from the run's prior events (identity from RunQueued,
   * traceIds from MessageSnapshot/TextMessageEnd) when omitted.
   */
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  traceIds: z.array(z.string()).optional(),
  occurredAt: z.number(),
});
export type FinishRunCommandData = z.infer<typeof finishRunCommandDataSchema>;

export const textMessageStartCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
  occurredAt: z.number(),
});
export type TextMessageStartCommandData = z.infer<typeof textMessageStartCommandDataSchema>;

export const textMessageEndCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
  occurredAt: z.number(),
});
export type TextMessageEndCommandData = z.infer<typeof textMessageEndCommandDataSchema>;

export const computeRunMetricsCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  traceId: z.string(),
  /** ECST payload: metrics carried from trace-side subscriber. Omitted in pull mode. */
  metrics: z
    .object({
      totalCost: z.number(),
      roleCosts: z.record(z.string(), z.number()),
      roleLatencies: z.record(z.string(), z.number()),
    })
    .optional(),
  retryCount: z.number().default(0),
  occurredAt: z.number(),
});
export type ComputeRunMetricsCommandData = z.infer<typeof computeRunMetricsCommandDataSchema>;

export const deleteRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});
export type DeleteRunCommandData = z.infer<typeof deleteRunCommandDataSchema>;

/**
 * Bulk-archive command. One user intent collapses N runs into one event;
 * tracks lw#3636.
 */
export const archiveSetCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioSetId: z.string(),
  scenarioRunIds: z.array(z.string()).min(1),
  occurredAt: z.number(),
});
export type ArchiveSetCommandData = z.infer<typeof archiveSetCommandDataSchema>;
export * from "@langwatch/simulation-contract";
export * from "@langwatch/simulation-contract";
export {
  SIMULATION_EVENT_RUN_STATUSES as SIMULATION_RUN_STATUS,
  SIMULATION_EVENT_VERDICTS as SIMULATION_VERDICT,
  simulationEventMessageSchema as simulationMessageSchema,
  simulationEventResultsSchema as simulationResultsSchema,
} from "@langwatch/simulation-contract";
export type {
  SimulationEventMessage as SimulationMessage,
  SimulationEventResults as SimulationResults,
  SimulationEventRunStatus as SimulationRunStatus,
  SimulationEventVerdict as SimulationVerdict,
} from "@langwatch/simulation-contract";
export {
  isSimulationMessageSnapshotEvent,
  isSimulationRunCancelRequestedEvent,
  isSimulationRunDeletedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunMetricsComputedEvent,
  isSimulationRunQueuedEvent,
  isSimulationRunStartedEvent,
  isSimulationSetArchivedEvent,
  isSimulationTextMessageEndEvent,
  isSimulationTextMessageStartEvent,
} from "@langwatch/simulation-contract";
