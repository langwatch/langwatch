/**
 * `/api/simulation-runs`: individual runs and batch summaries read from ScenarioApi.
 */
import { createLogger } from "@langwatch/observability";
import {
  ScenarioApi,
  type BatchSummary,
  type ScenarioRunData,
  scenarioLegacyErrorBodySchema,
  scenarioRunRestResponseWithPlatformUrlSchema,
  simulationBatchSummaryRestSchema,
  simulationRunListQuerySchema,
  simulationBatchQuerySchema,
  scenarioRunIdParamsSchema,
  batchRunIdParamsSchema,
  simulationRunListResponseSchema,
  simulationBatchListResponseSchema,
} from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:simulation-runs");

/**
 * Platform's own address for ONE simulation run (opens in scenarioRunDetail drawer).
 * Type kept for createScenarioRunPlatformUrlBuilder (app.platformUrl resolves directly).
 */
export type ScenarioRunPlatformUrlBuilder = (args: {
  projectSlug: string;
  scenarioRunId: string;
}) => string;

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

const notFoundResponse = {
  404: {
    description: "Not found",
    content: { "application/json": { schema: resolver(scenarioLegacyErrorBodySchema) } },
  },
};

/**
 * REST for the runs a simulation produced. `platformUrl` and
 * `findBatchSummary` are both resolved off `ScenarioApi`.
 */
export function createSimulationRunsRest() {
  const withPlatformUrl = (app: ScenarioApi, run: ScenarioRunData, projectSlug: string) => ({
    ...toRunResponse(run),
    platformUrl: app.platformUrl({ projectSlug, path: `/simulations/${run.scenarioRunId}` }),
  });

  return defineRestRouter(ScenarioApi)
    .withNamespace("simulation-runs")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "getApiSimulationRuns")
    .withQuery(simulationRunListQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(simulationRunListResponseSchema)
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
        return { runs: runs.map((r) => withPlatformUrl(app, r, project.projectSlug)), hasMore: false };
      }

      if (scenarioSetId) {
        const result = await app.getRunDataForScenarioSet({
          projectId,
          scenarioSetId,
          limit,
          cursor,
        });

        return {
          runs: result.runs.map((r) => withPlatformUrl(app, r, project.projectSlug)),
          hasMore: result.nextCursor !== null,
          nextCursor: result.nextCursor ?? undefined,
        };
      }

      const result = await app.getRunDataForAllSuites({ projectId, limit, cursor });

      if (!result.changed) return { runs: [], hasMore: false };

      return {
        runs: result.runs.map((r) => withPlatformUrl(app, r, project.projectSlug)),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      };
    })

    .get("/:scenarioRunId", "getApiSimulationRunsByScenarioRunId")
    .withParams(scenarioRunIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(scenarioRunRestResponseWithPlatformUrlSchema)
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

      return withPlatformUrl(app, run, project.projectSlug);
    })

    .get("/batches/list", "getApiSimulationRunsBatchesList")
    .withQuery(simulationBatchQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(simulationBatchListResponseSchema)
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

    .get("/batches/:batchRunId", "getApiSimulationRunsBatchesByBatchRunId")
    .withParams(batchRunIdParamsSchema)
    .withPermission("scenarios:view")
    .withOutput(simulationBatchSummaryRestSchema)
    .withDocs({
      description: "Get the summary of a single batch run, including its completion flag",
      responses: notFoundResponse,
    })
    .handle(async ({ app, input, scope }) => {
      const projectId = scope.id;
      logger.info({ projectId, batchRunId: input.batchRunId }, "Getting batch summary");

      const batch = await app.findBatchSummary({ projectId, batchRunId: input.batchRunId });
      if (!batch) throw new SimulationRunNotThereError("Batch run not found");

      return toBatchSummaryResponse(batch);
    })

    .build();
}
