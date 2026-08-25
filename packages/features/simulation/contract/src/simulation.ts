import { z } from "zod";

/**
 * Persisted and wire-visible state of one simulation run.
 *
 * `STALLED` remains readable for historical rows. New stalled executions end
 * as `ERROR` through the execution process manager.
 */
export enum SimulationRunStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING = "PENDING",
  FAILED = "FAILED",
  STALLED = "STALLED",
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
}
export const simulationRunStatusSchema = z.nativeEnum(SimulationRunStatus);

export enum SimulationVerdict {
  SUCCESS = "success",
  FAILURE = "failure",
  INCONCLUSIVE = "inconclusive",
}
export const simulationVerdictSchema = z.nativeEnum(SimulationVerdict);

/** A stored message deliberately keeps its provider-specific fields. */
export const simulationMessageSchema = z.looseObject({
  role: z.string().optional(),
  content: z.unknown().optional(),
  id: z.string().optional(),
  trace_id: z.string().optional(),
});
export type SimulationMessage = z.infer<typeof simulationMessageSchema>;

export const simulationRunResultSchema = z.object({
  verdict: simulationVerdictSchema,
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  error: z.string().optional(),
});
export type SimulationRunResult = z.infer<typeof simulationRunResultSchema>;

/** Platform metadata carried with runs started by a simulation suite. */
export const simulationRunMetadataSchema = z
  .looseObject({
    name: z.string().optional(),
    description: z.string().optional(),
    langwatch: z
      .object({
        targetReferenceId: z.string(),
        targetType: z.enum(["prompt", "http", "code", "workflow"]),
        simulationSuiteId: z.string().optional(),
      })
      .optional(),
  })
  .nullable()
  .optional();
export type SimulationRunMetadata = z.infer<
  typeof simulationRunMetadataSchema
>;

export const simulationRunDataSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioSetId: z.string().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  metadata: simulationRunMetadataSchema,
  status: simulationRunStatusSchema,
  results: simulationRunResultSchema.nullable().optional(),
  messages: z.array(simulationMessageSchema),
  timestamp: z.number(),
  updatedAt: z.number().optional(),
  durationInMs: z.number(),
  totalCost: z.number().optional(),
  roleCosts: z.record(z.string(), z.array(z.number())).optional(),
  roleLatencies: z.record(z.string(), z.array(z.number())).optional(),
});
export type SimulationRunData = z.infer<typeof simulationRunDataSchema>;

/** Complete run record used by the paged CSV export. */
export const simulationExportRunSchema = simulationRunDataSchema.extend({
  scenarioSetId: z.string(),
  traceIds: z.array(z.string()),
});
export type SimulationExportRun = z.infer<typeof simulationExportRunSchema>;

export const simulationSetDataSchema = z.object({
  scenarioSetId: z.string(),
  scenarioCount: z.number(),
  lastRunAt: z.number(),
});
export type SimulationSetData = z.infer<typeof simulationSetDataSchema>;

export const simulationBatchSummarySchema = z.object({
  batchRunId: z.string(),
  totalCount: z.number(),
  passCount: z.number(),
  failCount: z.number(),
  runningCount: z.number(),
  settledCount: z.number(),
  stalledCount: z.number(),
  lastRunAt: z.number(),
  lastUpdatedAt: z.number(),
  firstCompletedAt: z.number().nullable(),
  allCompletedAt: z.number().nullable(),
});
export type SimulationBatchSummary = z.infer<typeof simulationBatchSummarySchema>;

export const simulationBatchHistoryItemSchema = simulationBatchSummarySchema.extend({
  items: z.array(
    z.object({
      scenarioRunId: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      status: simulationRunStatusSchema,
      durationInMs: z.number(),
      messagePreview: z.array(z.object({ role: z.string(), content: z.string() })),
    }),
  ),
});
export type SimulationBatchHistoryItem = z.infer<typeof simulationBatchHistoryItemSchema>;

export const simulationBatchHistorySchema = z.object({
  batches: z.array(simulationBatchHistoryItemSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  lastUpdatedAt: z.number(),
  totalCount: z.number(),
});
export type SimulationBatchHistory = z.infer<typeof simulationBatchHistorySchema>;

export const simulationBatchRunDataSchema = z.discriminatedUnion("changed", [
  z.object({ changed: z.literal(false), lastUpdatedAt: z.number() }),
  z.object({
    changed: z.literal(true),
    lastUpdatedAt: z.number(),
    runs: z.array(simulationRunDataSchema),
  }),
]);
export type SimulationBatchRunData = z.infer<typeof simulationBatchRunDataSchema>;

/** Conditional run-history page for every suite in a project. */
export const simulationAllSuitesRunDataSchema = z.discriminatedUnion(
  "changed",
  [
    z.object({ changed: z.literal(false), lastUpdatedAt: z.number() }),
    z.object({
      changed: z.literal(true),
      lastUpdatedAt: z.number(),
      runs: z.array(simulationRunDataSchema),
      scenarioSetIds: z.record(z.string(), z.string()),
      nextCursor: z.string().optional(),
      hasMore: z.boolean(),
    }),
  ],
);
export type SimulationAllSuitesRunData = z.infer<
  typeof simulationAllSuitesRunDataSchema
>;

export const simulationExternalSetSummarySchema = z.object({
  scenarioSetId: z.string(),
  passedCount: z.number(),
  failedCount: z.number(),
  totalCount: z.number(),
  lastRunTimestamp: z.number(),
});
export type SimulationExternalSetSummary = z.infer<
  typeof simulationExternalSetSummarySchema
>;
