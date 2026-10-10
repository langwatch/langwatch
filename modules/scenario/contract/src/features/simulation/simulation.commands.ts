import type { Named } from "@langwatch/module";
import { z } from "zod";

import { scenarioCriterionResultSchema } from "../../scenario-criterion-result.ts";
import { scenarioEvaluationResultSchema } from "../../schemas/event-schemas.ts";
import { runEvaluatorsSchema } from "../run/scenario-run-evaluators.ts";
import {
  simulationQueuedTargetSchema,
  simulationTargetSchema,
  simulationMessageSchema,
} from "./simulation.ts";

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

const simulationQueueRunSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  ...simulationRunDetailsSchema.shape,
  secretParameters: z.record(z.string(), z.string()).optional(),
  target: simulationQueuedTargetSchema.optional(),
  /** The evaluators the queuing owner pinned; absent, the run reads its own when queued. */
  evaluators: runEvaluatorsSchema.optional(),
});
export interface SimulationQueueRunSchema extends Named<
  typeof simulationQueueRunSchemaDefinition
> {}
export const simulationQueueRunSchema: SimulationQueueRunSchema =
  simulationQueueRunSchemaDefinition;
export type SimulationQueueRun = z.infer<typeof simulationQueueRunSchema>;

const simulationStartRunSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  ...simulationRunDetailsSchema.shape,
});
export interface SimulationStartRunSchema extends Named<
  typeof simulationStartRunSchemaDefinition
> {}
export const simulationStartRunSchema: SimulationStartRunSchema =
  simulationStartRunSchemaDefinition;
export type SimulationStartRun = z.infer<typeof simulationStartRunSchema>;

const simulationMessageSnapshotSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export interface SimulationMessageSnapshotSchema extends Named<
  typeof simulationMessageSnapshotSchemaDefinition
> {}
export const simulationMessageSnapshotSchema: SimulationMessageSnapshotSchema =
  simulationMessageSnapshotSchemaDefinition;
export type SimulationMessageSnapshot = z.infer<typeof simulationMessageSnapshotSchema>;

const simulationTextMessageStartSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export interface SimulationTextMessageStartSchema extends Named<
  typeof simulationTextMessageStartSchemaDefinition
> {}
export const simulationTextMessageStartSchema: SimulationTextMessageStartSchema =
  simulationTextMessageStartSchemaDefinition;
export type SimulationTextMessageStart = z.infer<typeof simulationTextMessageStartSchema>;

const simulationTextMessageEndSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export interface SimulationTextMessageEndSchema extends Named<
  typeof simulationTextMessageEndSchemaDefinition
> {}
export const simulationTextMessageEndSchema: SimulationTextMessageEndSchema =
  simulationTextMessageEndSchemaDefinition;
export type SimulationTextMessageEnd = z.infer<typeof simulationTextMessageEndSchema>;

const simulationFinishRunSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  results: z
    .object({
      verdict: z.enum(["success", "failure", "inconclusive"]),
      reasoning: z.string().optional(),
      metCriteria: z.array(z.string()).default([]),
      unmetCriteria: z.array(z.string()).default([]),
      inconclusiveCriteria: z.array(z.string()).optional(),
      criteria: z.array(scenarioCriterionResultSchema).optional(),
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
export interface SimulationFinishRunSchema extends Named<
  typeof simulationFinishRunSchemaDefinition
> {}
export const simulationFinishRunSchema: SimulationFinishRunSchema =
  simulationFinishRunSchemaDefinition;
export type SimulationFinishRun = z.infer<typeof simulationFinishRunSchema>;

export const simulationCancelRunSchema = simulationRunIdentitySchema;
export type SimulationCancelRun = z.infer<typeof simulationCancelRunSchema>;

export const simulationDeleteRunSchema = simulationRunIdentitySchema;
export type SimulationDeleteRun = z.infer<typeof simulationDeleteRunSchema>;

/** The connected agent instance that answered a run, reported by the child. */
const simulationRecordAgentInstanceSchemaDefinition = z.object({
  ...simulationRunIdentitySchema.shape,
  agentInstance: z.object({ hostname: z.string(), label: z.string().nullable() }),
});
export interface SimulationRecordAgentInstanceSchema extends Named<
  typeof simulationRecordAgentInstanceSchemaDefinition
> {}
export const simulationRecordAgentInstanceSchema: SimulationRecordAgentInstanceSchema =
  simulationRecordAgentInstanceSchemaDefinition;
export type SimulationRecordAgentInstance = z.infer<typeof simulationRecordAgentInstanceSchema>;

/** A voice run LangWatch ended at the maximum call duration, reported by the child. */
export const simulationRecordCutAtLimitSchema = simulationRunIdentitySchema;
export type SimulationRecordCutAtLimit = z.infer<typeof simulationRecordCutAtLimitSchema>;

const simulationComputeRunMetricsSchemaDefinition = z.object({
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
export interface SimulationComputeRunMetricsSchema extends Named<
  typeof simulationComputeRunMetricsSchemaDefinition
> {}
export const simulationComputeRunMetricsSchema: SimulationComputeRunMetricsSchema =
  simulationComputeRunMetricsSchemaDefinition;
export type SimulationComputeRunMetrics = z.infer<typeof simulationComputeRunMetricsSchema>;

const simulationArchiveSetSchemaDefinition = z.object({
  tenantId: z.string(),
  scenarioSetId: z.string(),
  scenarioRunIds: z.array(z.string()).min(1),
  occurredAt: z.number(),
});
export interface SimulationArchiveSetSchema extends Named<
  typeof simulationArchiveSetSchemaDefinition
> {}
export const simulationArchiveSetSchema: SimulationArchiveSetSchema =
  simulationArchiveSetSchemaDefinition;
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
const recordEvaluationsCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  evaluations: z.array(scenarioEvaluationResultSchema),
  occurredAt: z.number(),
});
export interface RecordEvaluationsCommandDataSchema extends Named<
  typeof recordEvaluationsCommandDataSchemaDefinition
> {}
export const recordEvaluationsCommandDataSchema: RecordEvaluationsCommandDataSchema =
  recordEvaluationsCommandDataSchemaDefinition;
export type RecordEvaluationsCommandData = z.infer<typeof recordEvaluationsCommandDataSchema>;
