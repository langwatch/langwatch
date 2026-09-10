/**
 * `/api/simulation-runs` - the runs a simulation produced: the individual
 * runs, and the batch summaries that aggregate them.
 *
 * Every read but one is answered off `ScenarioApi` directly. The one
 * exception - a single batch's summary - has no `ScenarioApi` member yet
 * (the contract-service fold for `SimulationService` has not reached it), so
 * `findBatchSummary` arrives as a factory port, exactly as
 * `scenarioRunPlatformUrl` does, resolved by the process at mount time.
 */
import { createLogger } from "@langwatch/observability";
import {
  ScenarioApi,
  type BatchSummary,
  type ScenarioRunData,
} from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import { z } from "zod";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:simulation-runs");

/**
 * The platform's own address for ONE simulation run.
 *
 * A run opens in the `scenarioRunDetail` drawer on the base simulations route,
 * and the same builder answers for the application's own UI, this response and
 * Langy's navigate fallback. It arrives as a port for the reason every
 * platform-URL builder does: the address is built from the deployment's
 * external origin, which a transport package has no access to and must not
 * read for itself.
 */
export type ScenarioRunPlatformUrlBuilder = (args: {
  projectSlug: string;
  scenarioRunId: string;
}) => string;

const scenarioRunResponseSchema = z.object({
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
      error: z.string().nullable().optional(),
    })
    .nullable(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
  timestamp: z.number(),
  updatedAt: z.number(),
  durationInMs: z.number(),
  totalCost: z.number().optional(),
  note: z
    .string()
    .nullable()
    .describe(
      "One short line saying why the run was started, as given when it was queued. Null on a run started without one.",
    ),
  scenarioVersion: z
    .number()
    .int()
    .nullable()
    .describe(
      "The version of the scenario at the moment the run was queued. Null on runs recorded before versions existed.",
    ),
});

const scenarioRunResponseWithPlatformUrlSchema = scenarioRunResponseSchema.extend({
  platformUrl: z.string().url(),
});

const batchSummarySchema = z.object({
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
    .describe(
      "One short line saying why the batch was run, as given when it was queued. Null on a batch run without one.",
    ),
});

/**
 * Adds the completion flag the API exposes on top of the stored counts.
 * An empty batch is never complete: it has nothing that settled.
 */
function toBatchSummaryResponse(batch: BatchSummary) {
  return {
    batchRunId: batch.batchRunId,
    totalCount: batch.totalCount,
    passCount: batch.passCount,
    failCount: batch.failCount,
    runningCount: batch.runningCount,
    settledCount: batch.settledCount,
    stalledCount: batch.stalledCount,
    lastRunAt: batch.lastRunAt,
    lastUpdatedAt: batch.lastUpdatedAt,
    firstCompletedAt: batch.firstCompletedAt,
    allCompletedAt: batch.allCompletedAt,
    isComplete: batch.settledCount === batch.totalCount && batch.totalCount > 0,
    note: batch.note,
  };
}

/**
 * The API's view of one run. The published fields are mapped one by one off
 * the run's metadata, and the metadata itself stays out of the response: its
 * layout is internal, the fields are the contract.
 */
function toRunResponse(run: ScenarioRunData) {
  const { metadata, results, messages, ...rest } = run;
  return {
    ...rest,
    name: run.name ?? null,
    description: run.description ?? null,
    results: results ?? null,
    updatedAt: run.updatedAt ?? run.timestamp,
    messages: messages.map((m) => ({
      role: typeof m.role === "string" ? m.role : "",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
    })),
    note: metadata?.note ?? null,
    scenarioVersion: metadata?.langwatch?.scenarioVersion ?? null,
  };
}

const listQuerySchema = z.object({
  scenarioSetId: z.string().optional(),
  batchRunId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  cursor: z.string().optional(),
});

const batchQuerySchema = z.object({
  scenarioSetId: z.string(),
  limit: z.coerce.number().int().positive().max(50).optional().default(10),
  cursor: z.string().optional(),
});

/**
 * A run or a batch this project does not hold. The family answers it in the
 * bare `{ error }` body it has always had, so the miss is raised as the
 * family's own error and rendered by the family's own handler.
 */
export class SimulationRunNotThereError extends Error {}

/** The family's 404s, in the body they have always had. */
export const simulationRunErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof SimulationRunNotThereError) {
      return c.json({ error: error.message }, 404);
    }
    return boundary(error, c);
  };

const scenarioRunIdParamsSchema = z.object({ scenarioRunId: z.string().min(1) });
const batchRunIdParamsSchema = z.object({ batchRunId: z.string().min(1) });

const runListResponseSchema = z.object({
  runs: z.array(scenarioRunResponseWithPlatformUrlSchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});

const batchListResponseSchema = z.object({
  batches: z.array(batchSummarySchema),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().optional(),
});

const legacyErrorBodySchema = z.object({ error: z.string() });
const notFoundResponse = {
  404: {
    description: "Not found",
    content: { "application/json": { schema: resolver(legacyErrorBodySchema) } },
  },
};

/**
 * REST for the runs a simulation produced. `scenarioRunPlatformUrl` and
 * `findBatchSummary` are resolved by the process at mount time.
 */
export function createSimulationRunsRest(options: {
  scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
  findBatchSummary: (input: {
    projectId: string;
    batchRunId: string;
  }) => Promise<BatchSummary | null>;
}) {
  const { scenarioRunPlatformUrl, findBatchSummary } = options;

  const withPlatformUrl = (run: ScenarioRunData, projectSlug: string) => ({
    ...toRunResponse(run),
    platformUrl: scenarioRunPlatformUrl({ projectSlug, scenarioRunId: run.scenarioRunId }),
  });

  return defineRestRouter(ScenarioApi)
    .withNamespace("simulation-runs")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "listSimulationRuns")
    .withQuery(listQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(runListResponseSchema)
    .withDocs({
      description: "List simulation runs, optionally filtered by scenarioSetId or batchRunId",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const { scenarioSetId, batchRunId, limit, cursor } = input;
      const projectId = scope.id;
      logger.info({ projectId, scenarioSetId, batchRunId }, "Listing simulation runs");

      if (batchRunId) {
        // The scenario set id narrows the query when given, but the batch id
        // alone is enough: the CLI's --wait polls with just the batch id it
        // was handed at scheduling time.
        const result = await app.getRunDataForBatchRun({ projectId, scenarioSetId, batchRunId });

        if ("changed" in result && result.changed === false) {
          return { runs: [], hasMore: false };
        }

        const runs = "runs" in result ? result.runs : [];
        return { runs: runs.map((r) => withPlatformUrl(r, project.projectSlug)), hasMore: false };
      }

      if (scenarioSetId) {
        const result = await app.getRunDataForScenarioSet({
          projectId,
          scenarioSetId,
          limit,
          cursor,
        });

        return {
          runs: result.runs.map((r) => withPlatformUrl(r, project.projectSlug)),
          hasMore: result.nextCursor !== null,
          nextCursor: result.nextCursor ?? undefined,
        };
      }

      const result = await app.getRunDataForAllSuites({ projectId, limit, cursor });

      if (!result.changed) return { runs: [], hasMore: false };

      return {
        runs: result.runs.map((r) => withPlatformUrl(r, project.projectSlug)),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      };
    })

    .get("/:scenarioRunId", "getSimulationRun")
    .withParams(scenarioRunIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioRunResponseWithPlatformUrlSchema)
    .withDocs({
      description: "Get a single simulation run by its ID",
      responses: notFoundResponse,
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const projectId = scope.id;
      logger.info({ projectId, scenarioRunId: input.scenarioRunId }, "Getting simulation run");

      const run = await app.findScenarioRunData({
        projectId,
        scenarioRunId: input.scenarioRunId,
      });
      if (!run) throw new SimulationRunNotThereError("Simulation run not found");

      return withPlatformUrl(run, project.projectSlug);
    })

    .get("/batches/list", "listSimulationRunBatches")
    .withQuery(batchQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(batchListResponseSchema)
    .withDocs({
      description: "List batch summaries for a scenario set (pass/fail counts per batch)",
    })
    .handle(async ({ app, input, scope }) => {
      const { scenarioSetId, limit, cursor } = input;
      const projectId = scope.id;
      logger.info({ projectId, scenarioSetId }, "Listing batch history");

      const result = await app.getBatchHistoryForScenarioSet({
        projectId,
        scenarioSetId,
        limit,
        cursor,
      });

      return {
        batches: result.batches.map(toBatchSummaryResponse),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      };
    })

    .get("/batches/:batchRunId", "getSimulationRunBatch")
    .withParams(batchRunIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(batchSummarySchema)
    .withDocs({
      description: "Get the summary of a single batch run, including its completion flag",
      responses: notFoundResponse,
    })
    .handle(async ({ input, scope }) => {
      const projectId = scope.id;
      logger.info({ projectId, batchRunId: input.batchRunId }, "Getting batch summary");

      const batch = await findBatchSummary({ projectId, batchRunId: input.batchRunId });
      if (!batch) throw new SimulationRunNotThereError("Batch run not found");

      return toBatchSummaryResponse(batch);
    })

    .build();
}
