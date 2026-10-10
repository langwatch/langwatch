import type { Named } from "@langwatch/module";
import { z } from "zod";

import { FieldMappingSchema } from "../../resolve-field-mappings.ts";
import { scenarioCriterionResultSchema } from "../../scenario-criterion-result.ts";
import { scenarioEvaluationResultSchema } from "../../scenario-evaluation-result.ts";
import { runParameterValuesSchema } from "../../scenario.parameters.ts";
import { runActorLabelSchema } from "../run/run-actor.ts";

/**
 * Persisted and wire-visible state of one simulation run. `STALLED` remains readable for
 * historical rows. New stalled executions end as `ERROR` through the execution process manager.
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
  /**
   * Waiting for evaluators after judge verdict. Replaced on evaluation completion.
   */
  PENDING_EVALUATION = "PENDING_EVALUATION",
}
export const simulationRunStatusSchema = z.nativeEnum(SimulationRunStatus);

export enum SimulationVerdict {
  SUCCESS = "success",
  FAILURE = "failure",
  INCONCLUSIVE = "inconclusive",
}
export const simulationVerdictSchema = z.nativeEnum(SimulationVerdict);

/** A stored message deliberately keeps its provider-specific fields. */
const simulationMessageSchemaDefinition = z.looseObject({
  role: z.string().optional(),
  content: z.unknown().optional(),
  id: z.string().optional(),
  trace_id: z.string().optional(),
});
export interface SimulationMessageSchema extends Named<typeof simulationMessageSchemaDefinition> {}
export const simulationMessageSchema: SimulationMessageSchema = simulationMessageSchemaDefinition;
export type SimulationMessage = z.infer<typeof simulationMessageSchema>;

const simulationRunResultSchemaDefinition = z.object({
  verdict: simulationVerdictSchema,
  reasoning: z.string().optional(),
  metCriteria: z.array(z.string()),
  unmetCriteria: z.array(z.string()),
  /** Criteria the judge could not decide; each is also in `unmetCriteria`. */
  inconclusiveCriteria: z.array(z.string()).optional(),
  /**
   * Each criterion with its own status and reasoning. Always present on a
   * read: runs from older SDKs derive it from the criteria lists.
   */
  criteria: z.array(scenarioCriterionResultSchema).optional(),
  error: z.string().optional(),
  /**
   * One result per evaluator that ran on the scenario. Absent on a run with
   * no evaluators, and on results recorded before evaluators existed.
   */
  evaluations: z.array(scenarioEvaluationResultSchema).optional(),
});
export interface SimulationRunResultSchema extends Named<
  typeof simulationRunResultSchemaDefinition
> {}
export const simulationRunResultSchema: SimulationRunResultSchema =
  simulationRunResultSchemaDefinition;
export type SimulationRunResult = z.infer<typeof simulationRunResultSchema>;

/** Platform metadata carried with runs started by a simulation suite. */
const simulationRunMetadataSchemaDefinition = z
  .looseObject({
    name: z.string().optional(),
    description: z.string().optional(),
    /**
     * One short line describing why the batch was run. A TOP-LEVEL key, not a member of the
     * reserved namespace: it is the person's own words about the run, not platform context.
     * @see specs/scenarios/run-note-on-runs.feature
     */
    note: z.string().optional(),
    /**
     * The reserved namespace the queue path stamps.
     */
    langwatch: z
      .looseObject({
        targetReferenceId: z.string(),
        targetType: z.enum(["prompt", "http", "code", "workflow", "connected", "voice"]),
        /**
         * The key the target folds under: the reference id alone, or the
         * reference id and a hash of its parameter overrides. Absent on runs
         * recorded before targets carried parameters.
         */
        targetKey: z.string().optional(),
        /** The overrides of this target alone, so a reader can name the variant. */
        targetParameters: runParameterValuesSchema.optional(),
        simulationSuiteId: z.string().optional(),
        /** The scenario version the run was queued from. */
        scenarioVersion: z.number().int().optional(),
        /** The models the run plan was CONFIGURED with. */
        simulatorModel: z.string().optional(),
        judgeModel: z.string().optional(),
        /** The models the run actually RESOLVED and ran on. */
        resolvedSimulatorModel: z.string().optional(),
        resolvedJudgeModel: z.string().optional(),
        /** Who started the run, and the surface they acted through. */
        actorId: z.string().optional(),
        actorLabel: runActorLabelSchema.optional(),
        /** The connected agent instance that served the run. */
        agentInstance: z.object({ hostname: z.string(), label: z.string().nullable() }).optional(),
      })
      .optional(),
  })
  .nullable()
  .optional();
export interface SimulationRunMetadataSchema extends Named<
  typeof simulationRunMetadataSchemaDefinition
> {}
export const simulationRunMetadataSchema: SimulationRunMetadataSchema =
  simulationRunMetadataSchemaDefinition;
export type SimulationRunMetadata = z.infer<typeof simulationRunMetadataSchema>;

const simulationRunDataSchemaDefinition = z.object({
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
  // True when `messages` holds only the first few messages of a longer
  // conversation. List reads trim the message arrays to protect ClickHouse;
  // pass `shouldIncludeMessages` to read them all.
  messagesTruncated: z.boolean().optional(),
  timestamp: z.number(),
  updatedAt: z.number().optional(),
  durationInMs: z.number(),
  totalCost: z.number().optional(),
  roleCosts: z.record(z.string(), z.array(z.number())).optional(),
  roleLatencies: z.record(z.string(), z.array(z.number())).optional(),
});
export interface SimulationRunDataSchema extends Named<typeof simulationRunDataSchemaDefinition> {}
export const simulationRunDataSchema: SimulationRunDataSchema = simulationRunDataSchemaDefinition;
export type SimulationRunData = z.infer<typeof simulationRunDataSchema>;

/** Complete run record used by the paged CSV export. */
const simulationExportRunSchemaDefinition = z.object({
  ...simulationRunDataSchema.shape,
  scenarioSetId: z.string(),
  traceIds: z.array(z.string()),
});
export interface SimulationExportRunSchema extends Named<
  typeof simulationExportRunSchemaDefinition
> {}
export const simulationExportRunSchema: SimulationExportRunSchema =
  simulationExportRunSchemaDefinition;
export type SimulationExportRun = z.infer<typeof simulationExportRunSchema>;

const simulationSetDataSchemaDefinition = z.object({
  scenarioSetId: z.string(),
  scenarioCount: z.number(),
  lastRunAt: z.number(),
});
export interface SimulationSetDataSchema extends Named<typeof simulationSetDataSchemaDefinition> {}
export const simulationSetDataSchema: SimulationSetDataSchema = simulationSetDataSchemaDefinition;
export type SimulationSetData = z.infer<typeof simulationSetDataSchema>;

const simulationBatchSummarySchemaDefinition = z.object({
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
  note: z.string().nullable(),
  /**
   * The person who started this batch, or null when the batch names none.
   * @see specs/scenarios/run-actor-on-runs.feature
   */
  startedBy: z.object({ id: z.string(), label: runActorLabelSchema }).nullable(),
});
export interface SimulationBatchSummarySchema extends Named<
  typeof simulationBatchSummarySchemaDefinition
> {}
export const simulationBatchSummarySchema: SimulationBatchSummarySchema =
  simulationBatchSummarySchemaDefinition;
export type SimulationBatchSummary = z.infer<typeof simulationBatchSummarySchema>;

const simulationLastResultSummarySchemaDefinition = z.object({
  scenarioId: z.string(),
  status: simulationRunStatusSchema,
  metCriteriaCount: z.number(),
  unmetCriteriaCount: z.number(),
  lastRunAt: z.number(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  durationInMs: z.number().nullable(),
  totalCost: z.number().nullable(),
});
export interface SimulationLastResultSummarySchema extends Named<
  typeof simulationLastResultSummarySchemaDefinition
> {}
export const simulationLastResultSummarySchema: SimulationLastResultSummarySchema =
  simulationLastResultSummarySchemaDefinition;
export type SimulationLastResultSummary = z.infer<typeof simulationLastResultSummarySchema>;

const simulationBatchHistoryItemSchemaDefinition = z.object({
  ...simulationBatchSummarySchema.shape,
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
export interface SimulationBatchHistoryItemSchema extends Named<
  typeof simulationBatchHistoryItemSchemaDefinition
> {}
export const simulationBatchHistoryItemSchema: SimulationBatchHistoryItemSchema =
  simulationBatchHistoryItemSchemaDefinition;
export type SimulationBatchHistoryItem = z.infer<typeof simulationBatchHistoryItemSchema>;

const simulationBatchHistorySchemaDefinition = z.object({
  batches: z.array(simulationBatchHistoryItemSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  lastUpdatedAt: z.number(),
  totalCount: z.number(),
});
export interface SimulationBatchHistorySchema extends Named<
  typeof simulationBatchHistorySchemaDefinition
> {}
export const simulationBatchHistorySchema: SimulationBatchHistorySchema =
  simulationBatchHistorySchemaDefinition;
export type SimulationBatchHistory = z.infer<typeof simulationBatchHistorySchema>;

const simulationBatchRunDataSchemaDefinition = z.discriminatedUnion("changed", [
  z.object({ changed: z.literal(false), lastUpdatedAt: z.number() }),
  z.object({
    changed: z.literal(true),
    lastUpdatedAt: z.number(),
    runs: z.array(simulationRunDataSchema),
  }),
]);
export interface SimulationBatchRunDataSchema extends Named<
  typeof simulationBatchRunDataSchemaDefinition
> {}
export const simulationBatchRunDataSchema: SimulationBatchRunDataSchema =
  simulationBatchRunDataSchemaDefinition;
export type SimulationBatchRunData = z.infer<typeof simulationBatchRunDataSchema>;

/** Conditional run-history page for every suite in a project. */
const simulationAllSuitesRunDataSchemaDefinition = z.discriminatedUnion("changed", [
  z.object({ changed: z.literal(false), lastUpdatedAt: z.number() }),
  z.object({
    changed: z.literal(true),
    lastUpdatedAt: z.number(),
    runs: z.array(simulationRunDataSchema),
    scenarioSetIds: z.record(z.string(), z.string()),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
]);
export interface SimulationAllSuitesRunDataSchema extends Named<
  typeof simulationAllSuitesRunDataSchemaDefinition
> {}
export const simulationAllSuitesRunDataSchema: SimulationAllSuitesRunDataSchema =
  simulationAllSuitesRunDataSchemaDefinition;
export type SimulationAllSuitesRunData = z.infer<typeof simulationAllSuitesRunDataSchema>;

const simulationExternalSetSummarySchemaDefinition = z.object({
  scenarioSetId: z.string(),
  passedCount: z.number(),
  failedCount: z.number(),
  totalCount: z.number(),
  lastRunTimestamp: z.number(),
});
export interface SimulationExternalSetSummarySchema extends Named<
  typeof simulationExternalSetSummarySchemaDefinition
> {}
export const simulationExternalSetSummarySchema: SimulationExternalSetSummarySchema =
  simulationExternalSetSummarySchemaDefinition;
export type SimulationExternalSetSummary = z.infer<typeof simulationExternalSetSummarySchema>;

/** One page of a single suite's runs. */
const simulationScenarioSetRunDataSchemaDefinition = z.object({
  runs: z.array(simulationRunDataSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});
export interface SimulationScenarioSetRunDataSchema extends Named<
  typeof simulationScenarioSetRunDataSchemaDefinition
> {}
export const simulationScenarioSetRunDataSchema: SimulationScenarioSetRunDataSchema =
  simulationScenarioSetRunDataSchemaDefinition;

/** The cheap freshness probe the run-history views poll. */
const simulationRunFreshnessSchemaDefinition = z.object({ lastUpdatedAt: z.number() });
export interface SimulationRunFreshnessSchema extends Named<
  typeof simulationRunFreshnessSchemaDefinition
> {}
export const simulationRunFreshnessSchema: SimulationRunFreshnessSchema =
  simulationRunFreshnessSchemaDefinition;

/** How many batch runs a suite has in the window. */
const simulationBatchRunCountSchemaDefinition = z.object({ count: z.number() });
export interface SimulationBatchRunCountSchema extends Named<
  typeof simulationBatchRunCountSchemaDefinition
> {}
export const simulationBatchRunCountSchema: SimulationBatchRunCountSchema =
  simulationBatchRunCountSchemaDefinition;

/**
 * One frame of the simulation stream. The envelope is what the client parses;
 * the event itself is the broadcast payload, carried as the JSON text the
 * publisher wrote.
 */
const simulationStreamFrameSchemaDefinition = z.object({
  event: z.unknown(),
  timestamp: z.number().optional(),
});
export interface SimulationStreamFrameSchema extends Named<
  typeof simulationStreamFrameSchemaDefinition
> {}
export const simulationStreamFrameSchema: SimulationStreamFrameSchema =
  simulationStreamFrameSchemaDefinition;

export type SimulationStreamFrame = z.infer<typeof simulationStreamFrameSchema>;

/**
 * What a simulation run points at: domain shape, not transport shape, so
 * the services that resolve it and the router that accepts it read the
 * same definition. Extensible as the platform grows a new type.
 */

const simulationTargetSchemaDefinition = z.object({
  type: z.enum(["prompt", "http", "code", "workflow", "connected", "voice"]),
  referenceId: z.string(),
});
export interface SimulationTargetSchema extends Named<typeof simulationTargetSchemaDefinition> {}
export const simulationTargetSchema: SimulationTargetSchema = simulationTargetSchemaDefinition;

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;

/** A queued run's target, with the field mappings a suite's prompt target pins on it. */
const simulationQueuedTargetSchemaDefinition = z.object({
  ...simulationTargetSchema.shape,
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
});
export interface SimulationQueuedTargetSchema extends Named<
  typeof simulationQueuedTargetSchemaDefinition
> {}
export const simulationQueuedTargetSchema: SimulationQueuedTargetSchema =
  simulationQueuedTargetSchemaDefinition;
