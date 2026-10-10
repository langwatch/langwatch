import type { Named } from "@langwatch/module";
import { z } from "zod";

import { scenarioCriterionResultSchema } from "../../scenario-criterion-result.ts";
import { scenarioEvaluationResultSchema } from "../../scenario-evaluation-result.ts";
import { scenarioLegacyErrorBodySchema } from "../../scenario-rest.schemas.ts";

export { scenarioLegacyErrorBodySchema };

const scenarioRunRestResponseSchemaDefinition = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioSetId: z.string().optional(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  results: z
    .object({
      verdict: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
      metCriteria: z.array(z.string()).optional(),
      unmetCriteria: z.array(z.string()).optional(),
      inconclusiveCriteria: z
        .array(z.string())
        .optional()
        .describe(
          "Criteria the judge could not check because the evidence was missing. Each is also in `unmetCriteria`.",
        ),
      criteria: z
        .array(scenarioCriterionResultSchema)
        .optional()
        .describe(
          "Each criterion with its status (`passed`, `failed` or `inconclusive`) and the judge's reasoning for it, in the order the scenario declares them. Runs from SDKs before per-criterion verdicts carry an empty reasoning.",
        ),
      error: z.string().nullable().optional(),
      evaluations: z
        .array(scenarioEvaluationResultSchema)
        .optional()
        .describe(
          "One result per evaluator that ran on the scenario. Absent on a run with no evaluators, and on servers that predate evaluators.",
        ),
    })
    .nullable(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
  messagesTruncated: z
    .boolean()
    .optional()
    .describe(
      "True when `messages` holds only the first few messages of a longer conversation. Pass `include=messages` to read them all.",
    ),
  timestamp: z.number(),
  updatedAt: z.number(),
  durationInMs: z.number(),
  totalCost: z.number().optional(),
  roleCosts: z.record(z.string(), z.array(z.number())).optional(),
  roleLatencies: z.record(z.string(), z.array(z.number())).optional(),
  note: z
    .string()
    .nullable()
    .optional()
    .describe(
      "One short line saying why the run was started, as given when it was queued. Null on a run started without one.",
    ),
  scenarioVersion: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "The version of the scenario at the moment the run was queued. Null on runs recorded before versions existed.",
    ),
});
export interface ScenarioRunRestResponseSchema extends Named<
  typeof scenarioRunRestResponseSchemaDefinition
> {}
export const scenarioRunRestResponseSchema: ScenarioRunRestResponseSchema =
  scenarioRunRestResponseSchemaDefinition;

const scenarioRunRestResponseWithPlatformUrlSchemaDefinition = z.object({
  ...scenarioRunRestResponseSchema.shape,
  platformUrl: z.string().url(),
});
export interface ScenarioRunRestResponseWithPlatformUrlSchema extends Named<
  typeof scenarioRunRestResponseWithPlatformUrlSchemaDefinition
> {}
export const scenarioRunRestResponseWithPlatformUrlSchema: ScenarioRunRestResponseWithPlatformUrlSchema =
  scenarioRunRestResponseWithPlatformUrlSchemaDefinition;

const simulationBatchSummaryRestSchemaDefinition = z.object({
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
  allCompletedAt: z
    .number()
    .nullable()
    .describe(
      "Deprecated: read settledCount and isComplete instead. It carries the last update time of a batch where no run is running.",
    )
    .meta({ deprecated: true }),
  isComplete: z.boolean().describe("True when every run of the batch reached a terminal status."),
  note: z
    .string()
    .nullable()
    .optional()
    .describe(
      "One short line saying why the batch was run, as given when it was queued. Null on a batch run without one.",
    ),
});
export interface SimulationBatchSummaryRestSchema extends Named<
  typeof simulationBatchSummaryRestSchemaDefinition
> {}
export const simulationBatchSummaryRestSchema: SimulationBatchSummaryRestSchema =
  simulationBatchSummaryRestSchemaDefinition;

const simulationRunListQuerySchemaDefinition = z.object({
  scenarioSetId: z.string().optional(),
  batchRunId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  cursor: z.string().optional(),
  include: z
    .literal("messages")
    .optional()
    .describe(
      "Pass `messages` to read whole conversations instead of the first few messages of each run. The page size is capped at 20 runs when set, and ends on a batch boundary.",
    ),
});
export interface SimulationRunListQuerySchema extends Named<
  typeof simulationRunListQuerySchemaDefinition
> {}
export const simulationRunListQuerySchema: SimulationRunListQuerySchema =
  simulationRunListQuerySchemaDefinition;

const simulationBatchQuerySchemaDefinition = z.object({
  scenarioSetId: z.string(),
  limit: z.coerce.number().int().positive().max(50).optional().default(10),
  cursor: z.string().optional(),
});
export interface SimulationBatchQuerySchema extends Named<
  typeof simulationBatchQuerySchemaDefinition
> {}
export const simulationBatchQuerySchema: SimulationBatchQuerySchema =
  simulationBatchQuerySchemaDefinition;

const scenarioRunIdParamsSchemaDefinition = z.object({ scenarioRunId: z.string().min(1) });
export interface ScenarioRunIdParamsSchema extends Named<
  typeof scenarioRunIdParamsSchemaDefinition
> {}
export const scenarioRunIdParamsSchema: ScenarioRunIdParamsSchema =
  scenarioRunIdParamsSchemaDefinition;
const batchRunIdParamsSchemaDefinition = z.object({ batchRunId: z.string().min(1) });
export interface BatchRunIdParamsSchema extends Named<typeof batchRunIdParamsSchemaDefinition> {}
export const batchRunIdParamsSchema: BatchRunIdParamsSchema = batchRunIdParamsSchemaDefinition;

const simulationRunListResponseSchemaDefinition = z.object({
  runs: z.array(scenarioRunRestResponseWithPlatformUrlSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});
export interface SimulationRunListResponseSchema extends Named<
  typeof simulationRunListResponseSchemaDefinition
> {}
export const simulationRunListResponseSchema: SimulationRunListResponseSchema =
  simulationRunListResponseSchemaDefinition;

const simulationBatchListResponseSchemaDefinition = z.object({
  batches: z.array(simulationBatchSummaryRestSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});
export interface SimulationBatchListResponseSchema extends Named<
  typeof simulationBatchListResponseSchemaDefinition
> {}
export const simulationBatchListResponseSchema: SimulationBatchListResponseSchema =
  simulationBatchListResponseSchemaDefinition;

export type SimulationRunRestResponse = z.infer<
  typeof scenarioRunRestResponseWithPlatformUrlSchema
>;
export type SimulationBatchSummaryRest = z.infer<typeof simulationBatchSummaryRestSchema>;
export type SimulationRunListQuery = z.infer<typeof simulationRunListQuerySchema>;
export type SimulationRunListResponse = z.infer<typeof simulationRunListResponseSchema>;

/** A run listing for the public API, read in the project whose slug its links carry. */
export type SimulationRunListInput = SimulationRunListQuery & {
  projectId: string;
  projectSlug: string;
};

/** One run for the public API, read in the project whose slug its link carries. */
export type SimulationRunLookupInput = {
  projectId: string;
  projectSlug: string;
  scenarioRunId: string;
};
