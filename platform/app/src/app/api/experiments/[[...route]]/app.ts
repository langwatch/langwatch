/**
 * Public REST API for experiments.
 *
 * Exposes the two endpoints that complement the existing
 * `/api/experiments/{slug}/run` and `/runs/{runId}` routes:
 *
 *   GET  /api/experiments
 *   GET  /api/experiments/{slug}
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
import type { Experiment } from "@langwatch/experiment-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createProjectApp } from "~/server/api/security";
import {
  baseResponses,
  patchZodOpenapi,
  requires,
  validator as zValidator,
} from "@langwatch/platform-api/app-rest";
import { createBlankWorkbenchState } from "~/server/experiments-v3/blank-workbench-state";
import {
  createExperimentBodySchema,
  createExperimentResponseSchema,
  handledErrorEnvelopeSchema,
} from "~/server/routes/experiments-v3.schemas";
import { workbenchActorFrom } from "~/server/experiments-v3/workbench-actor";

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
    tags: ["Experiments"],
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

    logger.info({ projectId: project.id, page, pageSize }, "Listing experiments");

    const { experiments: paged, totalHits } = await c.app.experiments.getPage({
      projectId: project.id,
      page,
      pageSize,
    });

    const runAggregates =
      paged.length > 0
        ? await c.app.experiments.getRunAggregates({
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

// Read one experiment, by the slug the list route just handed the caller.
//
// The namespace already answered `POST /:slug/run`, `GET /:slug/versions` and
// `GET /:slug/workbench-state` for that same slug, so the one call a reader
// makes first, list and then fetch one, was the only one missing. It fell
// through to the framework's own 404, which says `{"error":"Not Found"}` and
// cannot be told apart from "no such experiment": callers concluded the
// experiment was gone while the list was still returning it.
//
// Answers the same object the list puts in its array, run count and last run
// included, so a caller holds one shape for both calls.
//
// `:slug` is a parameter segment at the root of a namespace whose siblings are
// literal (`/runs`, `/runs/:runId`), and those live in the v3 app, which mounts
// ahead of this one (see `server/api-router.ts`). The route-auth regression
// test pins both directions, because a parameter swallowing a literal sibling
// breaks in production rather than in a unit test.
secured.access(requires("experiments:view")).get(
  "/:slug",
  describeRoute({
    summary: "Read one experiment",
    description:
      "Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id as well, so either identifier the list hands back can be used.",
    tags: ["Experiments"],
    parameters: [
      {
        in: "path",
        name: "slug",
        required: true,
        schema: { type: "string" },
        description: "The experiment's slug, or its id",
      },
    ],
    responses: {
      ...baseResponses,
      404: {
        description: "No experiment with that slug or id in this project",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(experimentSummarySchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const slugOrId = c.req.param("slug");

    // Slug first, because that is what the list route returns as `slug` and
    // what every sibling route in this namespace takes. The id is accepted too
    // rather than refused, since the same list row carries both and a caller
    // reaching for `id` is not making a mistake worth a 404.
    const experiment = await c.app.experiments.getBySlugOrId({
      projectId: project.id,
      slugOrId,
    });

    const aggregates = await c.app.experiments.getRunAggregates({
      projectId: project.id,
      experimentIds: [experiment.id],
    });
    const aggregate = aggregates[experiment.id] ?? {
      runsCount: 0,
      lastRunAt: null,
    };

    return c.json(
      toExperimentSummary({
        experiment,
        runsCount: aggregate.runsCount,
        lastRunAt: aggregate.lastRunAt,
      }),
    );
  },
);

secured.access(requires("experiments:create")).post(
  "/",
  describeRoute({
    summary: "Create an experiment and its setup",
    description:
      "Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench with one inline dataset. The slug it answers with is what every other experiment endpoint takes.",
    tags: ["Experiments"],
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

    const created = await c.app.experiments.createEvaluationsV3({
      projectId: project.id,
      ...(body.name ? { name: body.name } : {}),
      state,
      actor: workbenchActorFrom({ resolved: c.get("resolvedToken") }),
    });

    logger.info({ projectId: project.id, slug: created.slug }, "Experiment created over REST");

    return c.json({
      id: created.experimentId,
      slug: created.slug,
      version: created.version,
    });
  },
);

export const app = secured.hono;
