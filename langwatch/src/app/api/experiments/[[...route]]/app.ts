/**
 * Public REST API for experiments.
 *
 * Currently exposes only the list endpoint that complements the existing
 * `/api/evaluations/v3/{slug}/run` and `/runs/{runId}` routes:
 *
 *   GET /api/experiments
 *
 * Auth: standard project API key (X-Auth-Token / Bearer / Basic).
 *
 * Routes go through `ExperimentService` (app-layer pattern) — no direct
 * Prisma access here. Experiment runs are joined in via
 * `ExperimentRunService.listRuns` so each summary includes a run count and
 * the latest run's timestamps, matching what the dashboard already shows.
 */
import type { Experiment } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { prisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { ExperimentRunService } from "~/server/evaluations-v3/services/experiment-run.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  handleError,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

const logger = createLogger("langwatch:api:experiments");

type Variables = AuthMiddlewareVariables;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const experimentSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  type: z.string(),
  workflowId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  runsCount: z.number(),
  lastRunAt: z.string().nullable(),
});

const experimentsListResponseSchema = z.object({
  experiments: z.array(experimentSummarySchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    totalHits: z.number(),
    hasMore: z.boolean(),
  }),
});

const parsePositiveInt = ({
  value,
  fallback,
  max,
}: {
  value: string | undefined;
  fallback: number;
  max?: number;
}): number => {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
};

const toExperimentSummary = ({
  experiment,
  runsCount,
  lastRunAt,
}: {
  experiment: Experiment;
  runsCount: number;
  lastRunAt: number | null;
}) => ({
  id: experiment.id,
  slug: experiment.slug,
  name: experiment.name,
  type: experiment.type,
  workflowId: experiment.workflowId,
  createdAt: experiment.createdAt.toISOString(),
  updatedAt: experiment.updatedAt.toISOString(),
  runsCount,
  lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
});

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/experiments")
  .use(tracerMiddleware({ name: "experiments" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  .get(
    "/",
    describeRoute({
      description:
        "List experiments for the project. Includes a runs count and last-run timestamp per experiment.",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(experimentsListResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const page = parsePositiveInt({
        value: c.req.query("page"),
        fallback: 1,
      });
      const pageSize = parsePositiveInt({
        value: c.req.query("pageSize"),
        fallback: DEFAULT_PAGE_SIZE,
        max: MAX_PAGE_SIZE,
      });

      logger.info(
        { projectId: project.id, page, pageSize },
        "Listing experiments",
      );

      const experimentService = ExperimentService.create(prisma);
      const all = await experimentService.getAll({ projectId: project.id });

      // Sort by updatedAt desc to match the dashboard's evaluation list.
      const sorted = [...all].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

      const totalHits = sorted.length;
      const offset = (page - 1) * pageSize;
      const paged = sorted.slice(offset, offset + pageSize);

      let runsByExperimentId: Record<
        string,
        Array<{ timestamps: { createdAt: number } }>
      > = {};
      if (paged.length > 0) {
        const runService = ExperimentRunService.create(prisma);
        runsByExperimentId = (await runService.listRuns({
          projectId: project.id,
          experimentIds: paged.map((e) => e.id),
        })) as typeof runsByExperimentId;
      }

      const experiments = paged.map((experiment) => {
        const runs = runsByExperimentId[experiment.id] ?? [];
        const lastRunAt = runs.reduce<number | null>((acc, run) => {
          const t = run.timestamps?.createdAt ?? null;
          if (t === null) return acc;
          return acc === null || t > acc ? t : acc;
        }, null);
        return toExperimentSummary({
          experiment,
          runsCount: runs.length,
          lastRunAt,
        });
      });

      return c.json({
        experiments,
        pagination: {
          page,
          pageSize,
          totalHits,
          hasMore: offset + paged.length < totalHits,
        },
      });
    },
  );
