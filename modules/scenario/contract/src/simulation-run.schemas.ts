import { z } from "zod";

import { scenarioCriterionResultSchema } from "./scenario-criterion-result.ts";
import { scenarioEvaluationResultSchema } from "./scenario-evaluation-result.ts";
import { scenarioLegacyErrorBodySchema } from "./scenario-rest.schemas.ts";

export { scenarioLegacyErrorBodySchema };

export const scenarioRunRestResponseSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
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

export const scenarioRunRestResponseWithPlatformUrlSchema = z.object({
  ...scenarioRunRestResponseSchema.shape,
  platformUrl: z.string().url(),
});

export const simulationBatchSummaryRestSchema = z.object({
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

export const simulationRunListQuerySchema = z.object({
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

export const simulationBatchQuerySchema = z.object({
  scenarioSetId: z.string(),
  limit: z.coerce.number().int().positive().max(50).optional().default(10),
  cursor: z.string().optional(),
});

export const scenarioRunIdParamsSchema = z.object({ scenarioRunId: z.string().min(1) });
export const batchRunIdParamsSchema = z.object({ batchRunId: z.string().min(1) });

export const simulationRunListResponseSchema = z.object({
  runs: z.array(scenarioRunRestResponseWithPlatformUrlSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});

export const simulationBatchListResponseSchema = z.object({
  batches: z.array(simulationBatchSummaryRestSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});
