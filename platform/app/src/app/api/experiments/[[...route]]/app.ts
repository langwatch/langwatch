/**
 * Public REST API for experiments.
 *
 * Exposes the two endpoints that complement the existing
 * `/api/experiments/{slug}/run` and `/runs/{runId}` routes:
 *
 *   GET  /api/experiments
 *   POST /api/experiments
 *
 * The workbench endpoints an integrator uses to read and write one
 * experiment's setup live in `server/routes/experiments-v3.ts`, which serves
 * the rest of the `/api/experiments` namespace. Create lives HERE rather than
 * next to them because both apps publish into one OpenAPI document and the
 * generator replaces a path wholesale per app: a second app declaring the bare
 * `/api/experiments` path would drop the list operation from the document.
 *
 * Auth: standard project API key (X-Auth-Token / Bearer / Basic).
 *
 * Routes go through app-layer services — no direct Prisma access here.
 * Experiment runs are joined in via aggregate metadata so each summary
 * includes a run count and latest run timestamp without loading run history.
 */

import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { Experiment } from "~/generated/prisma/client";
import { createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import { createBlankWorkbenchState } from "~/server/experiments/blankWorkbenchState";
import {
  ExperimentService,
  type WorkbenchActor,
} from "~/server/experiments/experiment.service";
import { ExperimentRunService } from "~/server/experiments-v3/services/experiment-run.service";
import {
  createExperimentBodySchema,
  createExperimentResponseSchema,
  handledErrorEnvelopeSchema,
} from "~/server/routes/experiments-v3.schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
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
});

// Mirror the canonical experiments-list permission: the tRPC procedures that
// return this same project-scoped experiment list (experimentRouter
// getAllByProjectId / getAllForEvaluationsList) gate on experiments:view, the
// dedicated permission experiments now use instead of inheriting workflows:view.
secured.access(requires("experiments:view")).get(
  "/",
  describeRoute({
    summary: "List experiments for the project",
    description:
      "List experiments for the project. Includes a runs count and last-run timestamp per experiment.",
    parameters: [
      {
        in: "query",
        name: "page",
        required: false,
        schema: { type: "integer", default: 1 },
        description: "1-based page number",
      },
      {
        in: "query",
        name: "pageSize",
        required: false,
        schema: {
          type: "integer",
          default: DEFAULT_PAGE_SIZE,
          maximum: MAX_PAGE_SIZE,
        },
        description: `Experiments per page, capped at ${MAX_PAGE_SIZE}`,
      },
    ],
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

    const { experiments: paged, totalHits } = await ExperimentService.create(
      prisma,
    ).getPage({
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

/**
 * Who a REST create is attributed to.
 *
 * Langy signs its own writes: the chat mints an ephemeral key for itself, and
 * an experiment it creates must read as "Langy" in the version history rather
 * than as an anonymous integration. Every other key is an integration, which
 * is what `api` means. The user id rides along when the key has one, so a
 * personal key still names the person who minted it.
 */
const workbenchActorFrom = (
  resolved: ResolvedToken | undefined,
): WorkbenchActor => {
  if (resolved?.type !== "apiKey") return { label: "api" };
  return {
    ...(resolved.userId ? { userId: resolved.userId } : {}),
    label: resolved.isLangySessionKey ? "langy" : "api",
  };
};

secured.access(requires("experiments:create")).post(
  "/",
  describeRoute({
    summary: "Create an experiment",
    description:
      "Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench with one inline dataset. The slug it answers with is what every other experiment endpoint takes.",
    responses: {
      ...baseResponses,
      400: {
        description:
          "The setup did not match the schema (experiment_invalid_workbench_state) or points at something that no longer exists (experiment_workbench_missing_reference)",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
      200: {
        description: "Experiment created",
        content: {
          "application/json": {
            schema: resolver(createExperimentResponseSchema),
          },
        },
      },
    },
  }),
  zValidator("json", createExperimentBodySchema),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");

    // A caller that sends no setup still gets a workbench they can open, so
    // the create call is usable on its own rather than only as step one of a
    // create-then-save pair.
    const state = body.state ?? createBlankWorkbenchState({ name: body.name });

    const created = await ExperimentService.create(prisma).createEvaluationsV3({
      projectId: project.id,
      ...(body.name ? { name: body.name } : {}),
      state,
      actor: workbenchActorFrom(c.get("resolvedToken")),
    });

    logger.info(
      { projectId: project.id, slug: created.slug },
      "Experiment created over REST",
    );

    return c.json({
      id: created.experimentId,
      slug: created.slug,
      version: created.version,
    });
  },
);

export const app = secured.hono;
