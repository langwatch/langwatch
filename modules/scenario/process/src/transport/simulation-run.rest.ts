import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  resolver,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
/**
 * `/api/simulation-runs`: individual runs and batch summaries read from ScenarioApi.
 */
import { createLogger } from "@langwatch/observability";
import {
  BatchRunNotFoundError,
  SimulationRunNotFoundError,
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
import type { z } from "zod";

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
function toBatchSummaryResponse(batch: BatchSummary): {
  batchRunId: string;
  totalCount: number;
  passCount: number;
  failCount: number;
  runningCount: number;
  settledCount: number;
  stalledCount: number;
  lastRunAt: number;
  lastUpdatedAt: number;
  firstCompletedAt: number | null;
  allCompletedAt: number | null;
  isComplete: boolean;
  note: string | null;
} {
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
function toRunResponse(run: ScenarioRunData): Omit<
  ScenarioRunData,
  "metadata" | "results" | "messages" | "name" | "description" | "updatedAt"
> & {
  name: string | null;
  description: string | null;
  results: NonNullable<ScenarioRunData["results"]> | null;
  updatedAt: number;
  messages: { role: string; content: string }[];
  note: string | null;
  scenarioVersion: number | null;
} {
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
export function createSimulationRunsRest(): Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<ScenarioApi>;
}> {
  return defineRestRouter(ScenarioApi)
    .withNamespace("simulation-runs")
    .withVersion(MANAGEMENT_API_VERSION)

    .get("/", "getApiSimulationRuns")
    .withQuery(simulationRunListQuerySchema)
    .withPermission("scenarios:view")
    .withOutput(simulationRunListResponseSchema)
    .withDocs({
      description:
        "List simulation runs, optionally filtered by scenarioSetId or batchRunId. Set-level and unfiltered listings trim each run to its first few messages and report the trim as `messagesTruncated`; pass `include=messages` to read whole conversations, which caps the page at 20 runs, ending on a batch boundary. A batch-scoped listing always carries whole conversations.",
    })
    .withMiddleware(projectRestFacts)
    .handle(async ({ app, input, scope }, project) => {
      const { scenarioSetId, batchRunId, limit, cursor, include } = input;
      const projectId = scope.id;
      logger.info({ projectId, scenarioSetId, batchRunId }, "Listing simulation runs");

      if (batchRunId) {
        return batchRunsWithPlatformUrls({
          app,
          projectId,
          scenarioSetId,
          batchRunId,
          projectSlug: project.projectSlug,
        });
      }

      if (scenarioSetId) {
        const result = await app.getRunDataForScenarioSet({
          projectId,
          scenarioSetId,
          limit,
          cursor,
          shouldIncludeMessages: include === "messages",
        });

        return {
          runs: result.runs.map((r) => withPlatformUrl(app, r, project.projectSlug)),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor ?? undefined,
        };
      }

      const result = await app.getRunDataForAllSuites({
        projectId,
        limit,
        cursor,
        shouldIncludeMessages: include === "messages",
      });

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
      if (!run) throw new SimulationRunNotFoundError(input.scenarioRunId);

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
      if (!batch) throw new BatchRunNotFoundError(input.batchRunId);

      return toBatchSummaryResponse(batch);
    })

    .build();
}

async function batchRunsWithPlatformUrls({
  app,
  projectId,
  scenarioSetId,
  batchRunId,
  projectSlug,
}: {
  app: ScenarioApi;
  projectId: string;
  scenarioSetId: string | undefined;
  batchRunId: string;
  projectSlug: string;
}): Promise<{
  runs: z.infer<typeof scenarioRunRestResponseWithPlatformUrlSchema>[];
  hasMore: boolean;
}> {
  // The scenario set id narrows the query when given, but the batch id
  // alone is enough: the CLI's --wait polls with just the batch id it
  // was handed at scheduling time.
  const result = await app.getRunDataForBatchRun({ projectId, scenarioSetId, batchRunId });

  if ("changed" in result && result.changed === false) {
    return { runs: [], hasMore: false };
  }

  const runs = "runs" in result ? result.runs : [];
  return { runs: runs.map((r) => withPlatformUrl(app, r, projectSlug)), hasMore: false };
}

function withPlatformUrl(
  app: ScenarioApi,
  run: ScenarioRunData,
  projectSlug: string,
): z.infer<typeof scenarioRunRestResponseWithPlatformUrlSchema> {
  return {
    ...toRunResponse(run),
    platformUrl: app.platformUrl({ projectSlug, path: `/simulations/${run.scenarioRunId}` }),
  };
}
