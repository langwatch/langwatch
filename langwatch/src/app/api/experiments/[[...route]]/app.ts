/**
 * Public REST API for experiments.
 *
 * Currently exposes only the list endpoint that complements the existing
 * `/api/experiments/{slug}/run` and `/runs/{runId}` routes:
 *
 *   GET /api/experiments
 *
 * Auth: standard project API key (X-Auth-Token / Bearer / Basic).
 *
 * Routes go through app-layer services — no direct Prisma access here.
 * Experiment runs are joined in via aggregate metadata so each summary
 * includes a run count and latest run timestamp without loading run history.
 */
import type { Experiment } from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { prisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { ExperimentRunService } from "~/server/experiments-v3/services/experiment-run.service";
import { createProjectApp, requires } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

const logger = createLogger("langwatch:api:experiments");

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

const secured = createProjectApp({
  basePath: "/api/experiments",
  family: "experiments",
});

// Listing experiments is an evaluations read — mirror the evaluations:view
// ceiling the sibling run-inspection routes (GET /runs, /runs/:runId) enforce.
secured.access(requires("evaluations:view")).get(
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

      const { experiments: paged, totalHits } =
        await ExperimentService.create(prisma).getPage({
          projectId: project.id,
          page,
          pageSize,
        });

      const runAggregates =
        paged.length > 0
          ? await ExperimentRunService.create(
              prisma,
            ).getRunAggregatesForExperimentIds({
              projectId: project.id,
              experimentIds: paged.map((e) => e.id),
            })
          : {};

      const experiments = paged.map((experiment) => {
        const aggregate = runAggregates[experiment.id] ?? {
          runsCount: 0,
          lastRunAt: null,
        };
        return toExperimentSummary({
          experiment,
          runsCount: aggregate.runsCount,
          lastRunAt: aggregate.lastRunAt,
        });
      });

      const offset = (page - 1) * pageSize;
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

export const app = secured.hono;
