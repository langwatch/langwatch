import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { handleError } from "../../middleware";
import { SimulationFacade } from "~/server/simulations/simulation.facade";

patchZodOpenapi();

const logger = createLogger("langwatch:api:simulation-runs");

type Variables = AuthMiddlewareVariables;

const scenarioRunResponseSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
  results: z.object({
    verdict: z.string().nullable().optional(),
    reasoning: z.string().nullable().optional(),
    metCriteria: z.array(z.string()).optional(),
    unmetCriteria: z.array(z.string()).optional(),
    error: z.string().nullable().optional(),
  }).nullable(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })),
  timestamp: z.number(),
  updatedAt: z.number(),
  durationInMs: z.number(),
  totalCost: z.number().optional(),
});

const batchSummarySchema = z.object({
  batchRunId: z.string(),
  totalCount: z.number(),
  passCount: z.number(),
  failCount: z.number(),
  runningCount: z.number(),
  stalledCount: z.number(),
  lastRunAt: z.number(),
  lastUpdatedAt: z.number(),
  firstCompletedAt: z.number().nullable(),
  allCompletedAt: z.number().nullable(),
});

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

function createFacade() {
  return SimulationFacade.create();
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/simulation-runs")
  .use(tracerMiddleware({ name: "simulation-runs" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Runs ──────────────────────────────────────────────
  .get(
    "/",
    describeRoute({
      description: "List simulation runs, optionally filtered by scenarioSetId or batchRunId",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({
                runs: z.array(scenarioRunResponseSchema),
                hasMore: z.boolean().optional(),
                nextCursor: z.string().optional(),
              })),
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

      const facade = createFacade();

      if (batchRunId && scenarioSetId) {
        // Get runs for a specific batch
        const result = await facade.getRunDataForBatchRun({
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
            ...r,
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/simulations`,
            }),
          })),
          hasMore: false,
        });
      }

      if (scenarioSetId) {
        // Get runs for a scenario set
        const result = await facade.getRunDataForScenarioSet({
          projectId: project.id,
          scenarioSetId,
          limit,
          cursor,
        });

        return c.json({
          runs: result.runs.map((r) => ({
            ...r,
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/simulations`,
            }),
          })),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        });
      }

      // No filter - get all suite runs
      const result = await facade.getRunDataForAllSuites({
        projectId: project.id,
        limit,
        cursor,
      });

      if (!result.changed) {
        return c.json({ runs: [], hasMore: false });
      }

      return c.json({
        runs: result.runs.map((r) => ({
          ...r,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/simulations`,
          }),
        })),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    },
  )

  // ── Get Single Run ────────────────────────────────────────
  .get(
    "/:scenarioRunId",
    describeRoute({
      description: "Get a single simulation run by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(scenarioRunResponseSchema),
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

      const facade = createFacade();
      const run = await facade.getScenarioRunData({
        projectId: project.id,
        scenarioRunId,
      });

      if (!run) {
        return c.json({ error: "Simulation run not found" }, 404);
      }

      return c.json({
        ...run,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/simulations`,
        }),
      });
    },
  )

  // ── List Batches ──────────────────────────────────────────
  .get(
    "/batches/list",
    describeRoute({
      description: "List batch summaries for a scenario set (pass/fail counts per batch)",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({
                batches: z.array(batchSummarySchema),
                hasMore: z.boolean().optional(),
                nextCursor: z.string().optional(),
              })),
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

      const facade = createFacade();
      const result = await facade.getBatchHistoryForScenarioSet({
        projectId: project.id,
        scenarioSetId,
        limit,
        cursor,
      });

      return c.json({
        batches: result.batches.map((b) => ({
          batchRunId: b.batchRunId,
          totalCount: b.totalCount,
          passCount: b.passCount,
          failCount: b.failCount,
          runningCount: b.runningCount,
          stalledCount: b.stalledCount,
          lastRunAt: b.lastRunAt,
          lastUpdatedAt: b.lastUpdatedAt,
          firstCompletedAt: b.firstCompletedAt,
          allCompletedAt: b.allCompletedAt,
        })),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    },
  );
