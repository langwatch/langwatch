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
  ScenarioApi,
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

import { toBatchSummaryResponse } from "../rules/simulation-batch-summary.rules.ts";

const logger = createLogger("langwatch:api:simulation-runs");

/**
 * Platform's own address for ONE simulation run (opens in scenarioRunDetail drawer).
 * Type kept for createScenarioRunPlatformUrlBuilder (app.platformUrl resolves directly).
 */
export type ScenarioRunPlatformUrlBuilder = (args: {
  projectSlug: string;
  scenarioRunId: string;
}) => string;

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
    .handle(({ app, input, scope }, project) => {
      const { scenarioSetId, batchRunId } = input;
      logger.info({ projectId: scope.id, scenarioSetId, batchRunId }, "Listing simulation runs");
      return app.listSimulationRuns({
        ...input,
        projectId: scope.id,
        projectSlug: project.projectSlug,
      });
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
    .handle(({ app, input, scope }, project) => {
      const projectId = scope.id;
      logger.info({ projectId, scenarioRunId: input.scenarioRunId }, "Getting simulation run");
      return app.getSimulationRun({
        projectId,
        projectSlug: project.projectSlug,
        scenarioRunId: input.scenarioRunId,
      });
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
    .handle(({ app, input, scope }) => {
      const projectId = scope.id;
      logger.info({ projectId, batchRunId: input.batchRunId }, "Getting batch summary");
      return app.getBatchSummary({ projectId, batchRunId: input.batchRunId });
    })

    .build();
}
