import { z } from "zod";
import { simulationMessageSchema } from "./simulation";

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

export const simulationQueueRunSchema = simulationRunIdentitySchema
  .extend(simulationRunDetailsSchema.shape)
  .extend({
    secretParameters: z.record(z.string(), z.string()).optional(),
    target: z
      .object({
        type: z.enum(["prompt", "http", "code", "workflow"]),
        referenceId: z.string(),
      })
      .optional(),
  });
export type SimulationQueueRun = z.infer<typeof simulationQueueRunSchema>;

export const simulationStartRunSchema = simulationRunIdentitySchema.extend(
  simulationRunDetailsSchema.shape,
);
export type SimulationStartRun = z.infer<typeof simulationStartRunSchema>;

export const simulationMessageSnapshotSchema = simulationRunIdentitySchema.extend({
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshot = z.infer<typeof simulationMessageSnapshotSchema>;

export const simulationTextMessageStartSchema = simulationRunIdentitySchema.extend({
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageStart = z.infer<typeof simulationTextMessageStartSchema>;

export const simulationTextMessageEndSchema = simulationRunIdentitySchema.extend({
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEnd = z.infer<typeof simulationTextMessageEndSchema>;

export const simulationFinishRunSchema = simulationRunIdentitySchema.extend({
  results: z
    .object({
      verdict: z.enum(["success", "failure", "inconclusive"]),
      reasoning: z.string().optional(),
      metCriteria: z.array(z.string()).default([]),
      unmetCriteria: z.array(z.string()).default([]),
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
});
export type SimulationFinishRun = z.infer<typeof simulationFinishRunSchema>;

export const simulationCancelRunSchema = simulationRunIdentitySchema;
export type SimulationCancelRun = z.infer<typeof simulationCancelRunSchema>;

export const simulationDeleteRunSchema = simulationRunIdentitySchema;
export type SimulationDeleteRun = z.infer<typeof simulationDeleteRunSchema>;

export const simulationComputeRunMetricsSchema = simulationRunIdentitySchema.extend({
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
