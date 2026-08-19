import { createLogger } from "@langwatch/observability";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";
import { scenarioRunPlatformUrl } from "../scenario-run-platform-url";

patchZodOpenapi();

const logger = createLogger("langwatch:api:simulation-runs");

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
});

const scenarioRunResponseWithPlatformUrlSchema =
  scenarioRunResponseSchema.extend({
    platformUrl: z.string().url(),
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
  include: z
    .literal("messages")
    .optional()
    .describe(
      "Pass `messages` to read whole conversations instead of the first few messages of each run. The page size is capped at 20 runs when set, and ends on a batch boundary.",
    ),
});

const batchQuerySchema = z.object({
  scenarioSetId: z.string(),
  limit: z.coerce.number().int().positive().max(50).optional().default(10),
  cursor: z.string().optional(),
});

const secured = createProjectApp({ basePath: "/api/simulation-runs" });

// ── List Runs ──────────────────────────────────────────────
secured.access(requires("scenarios:view")).get(
  "/",
  describeRoute({
    description:
      "List simulation runs, optionally filtered by scenarioSetId or batchRunId. Set-level and unfiltered listings trim each run to its first few messages and report the trim as `messagesTruncated`; pass `include=messages` to read whole conversations, which caps the page at 20 runs, ending on a batch boundary. A batch-scoped listing always carries whole conversations.",
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
    const { scenarioSetId, batchRunId, limit, cursor, include } =
      c.req.valid("query");
    const shouldIncludeMessages = include === "messages";
    logger.info(
      { projectId: project.id, scenarioSetId, batchRunId },
      "Listing simulation runs",
    );

    const simulationRuns = getApp().simulations.runs;

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
          ...r,
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
        shouldIncludeMessages,
      });

      return c.json({
        runs: result.runs.map((r) => ({
          ...r,
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
      shouldIncludeMessages,
    });

    if (!result.changed) {
      return c.json({ runs: [], hasMore: false });
    }

    return c.json({
      runs: result.runs.map((r) => ({
        ...r,
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
    logger.info(
      { projectId: project.id, scenarioRunId },
      "Getting simulation run",
    );

    const simulationRuns = getApp().simulations.runs;
    const run = await simulationRuns.getScenarioRunData({
      projectId: project.id,
      scenarioRunId,
    });

    if (!run) {
      return c.json({ error: "Simulation run not found" }, 404);
    }

    return c.json({
      ...run,
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
    description:
      "List batch summaries for a scenario set (pass/fail counts per batch)",
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
    logger.info(
      { projectId: project.id, scenarioSetId },
      "Listing batch history",
    );

    const simulationRuns = getApp().simulations.runs;
    const result = await simulationRuns.getBatchHistoryForScenarioSet({
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

export const app = secured.hono;
