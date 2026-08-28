import { createLogger } from "@langwatch/observability";
import type {
  BatchSummary,
  ScenarioRunData,
  SimulationService,
} from "@langwatch/scenario-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  patchZodOpenapi,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";

patchZodOpenapi();

const logger = createLogger("langwatch:api:simulation-runs");

/**
 * The platform's own address for ONE simulation run.
 *
 * A run opens in the `scenarioRunDetail` drawer on the base simulations route,
 * and the same builder answers for the application's own UI, this response and
 * Langy's navigate fallback. It arrives as a port for the reason
 * `PlatformUrlBuilder` does: the address is built from the deployment's
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
    // Machine-readable beside the sentence: a generated client marks the field
    // deprecated from this, not from the prose.
    .openapi({ deprecated: true }),
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
  const { metadata, ...rest } = run;
  return {
    ...rest,
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
 * REST for the runs a simulation produced — the individual runs, and the batch
 * summaries that aggregate them.
 *
 * The simulation capability arrives as a per-request provider rather than off
 * the Hono context, so this family can be mounted into any process that has
 * one and built with none by the OpenAPI generator.
 */
export function createSimulationRunsRestApp(options: {
  security: AppRestSecurity;
  simulations: () => SimulationService;
  scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, simulations, scenarioRunPlatformUrl } = options;

  const secured = security.createProjectApp({ basePath: "/api/simulation-runs" });

  // ── List Runs ──────────────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/",
    describeRoute({
      description: "List simulation runs, optionally filtered by scenarioSetId or batchRunId",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  runs: z.array(scenarioRunResponseWithPlatformUrlSchema),
                  hasMore: z.boolean().optional(),
                  nextCursor: z.string().optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    zValidator("query", listQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { scenarioSetId, batchRunId, limit, cursor } = c.req.valid("query");
      logger.info({ projectId: project.id, scenarioSetId, batchRunId }, "Listing simulation runs");

      const simulationRuns = simulations();

      if (batchRunId) {
        // Get runs for a specific batch. The scenario set id narrows the query
        // when given, but the batch id alone is enough: the CLI's --wait polls
        // with just the batch id it was handed at scheduling time.
        const result = await simulationRuns.getRunDataForBatchRun({
          projectId: project.id,
          scenarioSetId,
          batchRunId,
        });

        if ("changed" in result && result.changed === false) {
          return c.json({ runs: [], hasMore: false });
        }

        const runs = "runs" in result ? result.runs : [];
        return c.json({
          runs: runs.map((r) => ({
            ...toRunResponse(r),
            platformUrl: scenarioRunPlatformUrl({
              projectSlug: project.slug,
              scenarioRunId: r.scenarioRunId,
            }),
          })),
          hasMore: false,
        });
      }

      if (scenarioSetId) {
        // Get runs for a scenario set
        const result = await simulationRuns.getRunDataForScenarioSet({
          projectId: project.id,
          scenarioSetId,
          limit,
          cursor,
        });

        return c.json({
          runs: result.runs.map((r) => ({
            ...toRunResponse(r),
            platformUrl: scenarioRunPlatformUrl({
              projectSlug: project.slug,
              scenarioRunId: r.scenarioRunId,
            }),
          })),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        });
      }

      // No filter - get all suite runs
      const result = await simulationRuns.getRunDataForAllSuites({
        projectId: project.id,
        limit,
        cursor,
      });

      if (!result.changed) {
        return c.json({ runs: [], hasMore: false });
      }

      return c.json({
        runs: result.runs.map((r) => ({
          ...toRunResponse(r),
          platformUrl: scenarioRunPlatformUrl({
            projectSlug: project.slug,
            scenarioRunId: r.scenarioRunId,
          }),
        })),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    },
  );

  // ── Get Single Run ────────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/:scenarioRunId",
    describeRoute({
      description: "Get a single simulation run by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(scenarioRunResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Run not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { scenarioRunId } = c.req.param();
      logger.info({ projectId: project.id, scenarioRunId }, "Getting simulation run");

      const run = await simulations().tryGetScenarioRunData({
        projectId: project.id,
        scenarioRunId,
      });

      if (!run) {
        return c.json({ error: "Simulation run not found" }, 404);
      }

      return c.json({
        ...toRunResponse(run),
        platformUrl: scenarioRunPlatformUrl({
          projectSlug: project.slug,
          scenarioRunId: run.scenarioRunId,
        }),
      });
    },
  );

  // ── List Batches ──────────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/batches/list",
    describeRoute({
      description: "List batch summaries for a scenario set (pass/fail counts per batch)",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  batches: z.array(batchSummarySchema),
                  hasMore: z.boolean().optional(),
                  nextCursor: z.string().optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    zValidator("query", batchQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { scenarioSetId, limit, cursor } = c.req.valid("query");
      logger.info({ projectId: project.id, scenarioSetId }, "Listing batch history");

      const result = await simulations().getBatchHistoryForScenarioSet({
        projectId: project.id,
        scenarioSetId,
        limit,
        cursor,
      });

      return c.json({
        batches: result.batches.map(toBatchSummaryResponse),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    },
  );

  // ── Get Single Batch ──────────────────────────────────────
  secured.access(requires("scenarios:view")).get(
    "/batches/:batchRunId",
    describeRoute({
      description: "Get the summary of a single batch run, including its completion flag",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": { schema: resolver(batchSummarySchema) },
          },
        },
        404: {
          description: "Batch run not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { batchRunId } = c.req.param();
      logger.info({ projectId: project.id, batchRunId }, "Getting batch summary");

      const batch = await simulations().tryGetBatchSummary({
        projectId: project.id,
        batchRunId,
      });

      if (!batch) {
        return c.json({ error: "Batch run not found" }, 404);
      }

      return c.json(toBatchSummaryResponse(batch));
    },
  );

  return secured;
}
