import { z } from "zod";

import { scenarioEvaluationResultSchema } from "./schemas/event-schemas.ts";
import { simulationTargetSchema } from "./simulation-target.ts";
import { simulationMessageSchema } from "./simulation.ts";

const simulationRunIdentitySchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});

const simulationRunDetailsSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const simulationQueueRunSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  ...simulationRunDetailsSchema.shape,
  secretParameters: z.record(z.string(), z.string()).optional(),
  target: simulationTargetSchema.optional(),
});
export type SimulationQueueRun = z.infer<typeof simulationQueueRunSchema>;

export const simulationStartRunSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  ...simulationRunDetailsSchema.shape,
});
export type SimulationStartRun = z.infer<typeof simulationStartRunSchema>;

export const simulationMessageSnapshotSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshot = z.infer<typeof simulationMessageSnapshotSchema>;

export const simulationTextMessageStartSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageStart = z.infer<typeof simulationTextMessageStartSchema>;

export const simulationTextMessageEndSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEnd = z.infer<typeof simulationTextMessageEndSchema>;

export const simulationFinishRunSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  results: z
    .object({
      verdict: z.enum(["success", "failure", "inconclusive"]),
      reasoning: z.string().optional(),
      metCriteria: z.array(z.string()).default([]),
      unmetCriteria: z.array(z.string()).default([]),
      inconclusiveCriteria: z.array(z.string()).optional(),
      error: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  traceIds: z.array(z.string()).optional(),
  target: simulationTargetSchema.optional(),
});
export type SimulationFinishRun = z.infer<typeof simulationFinishRunSchema>;

export const simulationCancelRunSchema = simulationRunIdentitySchema;
export type SimulationCancelRun = z.infer<typeof simulationCancelRunSchema>;

export const simulationDeleteRunSchema = simulationRunIdentitySchema;
export type SimulationDeleteRun = z.infer<typeof simulationDeleteRunSchema>;

/** The connected agent instance that answered a run, reported by the child. */
export const simulationRecordAgentInstanceSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  agentInstance: z.object({ hostname: z.string(), label: z.string().nullable() }),
});
export type SimulationRecordAgentInstance = z.infer<typeof simulationRecordAgentInstanceSchema>;

export const simulationComputeRunMetricsSchema = z.object({
  ...simulationRunIdentitySchema.shape,
  traceId: z.string(),
  metrics: z
    .object({
      totalCost: z.number(),
      roleCosts: z.record(z.string(), z.number()),
      roleLatencies: z.record(z.string(), z.number()),
    })
    .optional(),
  retryCount: z.number().default(0),
});
export type SimulationComputeRunMetrics = z.infer<typeof simulationComputeRunMetricsSchema>;

export const simulationArchiveSetSchema = z.object({
  tenantId: z.string(),
  scenarioSetId: z.string(),
  scenarioRunIds: z.array(z.string()).min(1),
  occurredAt: z.number(),
});
export type SimulationArchiveSet = z.infer<typeof simulationArchiveSetSchema>;

export const queueRunCommandDataSchema = simulationQueueRunSchema;
export type QueueRunCommandData = SimulationQueueRun;
export const startRunCommandDataSchema = simulationStartRunSchema;
export type StartRunCommandData = SimulationStartRun;
export const messageSnapshotCommandDataSchema = simulationMessageSnapshotSchema;
export type MessageSnapshotCommandData = SimulationMessageSnapshot;
export const finishRunCommandDataSchema = simulationFinishRunSchema;
export type FinishRunCommandData = SimulationFinishRun;
export const textMessageStartCommandDataSchema = simulationTextMessageStartSchema;
export type TextMessageStartCommandData = SimulationTextMessageStart;
export const textMessageEndCommandDataSchema = simulationTextMessageEndSchema;
export type TextMessageEndCommandData = SimulationTextMessageEnd;
export const computeRunMetricsCommandDataSchema = simulationComputeRunMetricsSchema;
export type ComputeRunMetricsCommandData = SimulationComputeRunMetrics;
export const deleteRunCommandDataSchema = simulationDeleteRunSchema;
export type DeleteRunCommandData = SimulationDeleteRun;
export const archiveSetCommandDataSchema = simulationArchiveSetSchema;
export type ArchiveSetCommandData = SimulationArchiveSet;

/**
 * Records the evaluator results of a finished run. Post-gate verdict,
 * identity and prior verdict are all read from the run's prior events by
 * RecordEvaluationsCommand, so the caller sends only the results.
 */
export const recordEvaluationsCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  evaluations: z.array(scenarioEvaluationResultSchema),
  occurredAt: z.number(),
});
export type RecordEvaluationsCommandData = z.infer<typeof recordEvaluationsCommandDataSchema>;
