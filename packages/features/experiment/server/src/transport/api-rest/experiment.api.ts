/**
 * Public REST API for experiments: `GET /api/experiments`, `GET
 * /api/experiments/{slug}`, `POST /api/experiments`. Auth: standard project
 * API key. Routes go through the feature's application.
 */

import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  baseResponses,
  credentialPrincipalOf,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import type { Experiment } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ExperimentApp } from "#app/experiment.app";
import {
  createExperimentBodySchema,
  createExperimentResponseSchema,
  handledErrorEnvelopeSchema,
} from "../../rules/experiment-schemas.rules.ts";

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

/**
 * A page number that never rejects: a value that is not a positive integer has
 * always fallen back rather than refused the request, so the schema is written
 * to say exactly that.
 */
const lenientPositiveInt = (fallback: number, max?: number) =>
  z
    .string()
    .optional()
    .transform((value) => parsePositiveInt({ value, fallback, ...(max ? { max } : {}) }));

const listExperimentsQuerySchema = z.object({
  page: lenientPositiveInt(1).describe("1-based page number"),
  pageSize: lenientPositiveInt(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE).describe(
    `Experiments per page, capped at ${MAX_PAGE_SIZE}`,
  ),
});

const slugParamsSchema = z.object({
  slug: z.string().min(1).describe("The experiment's slug, or its id"),
});

/** The experiments REST family, built against one process's security. */
export function createExperimentsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request. Mounting the family must not force the application
   * to be constructed, which is what lets the OpenAPI generator and the
   * route-registry audits build every route without a running process.
   */
  app: () => ExperimentApp;
}): MountableRestApp {
  const { security, app } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "experiments",
    basePath: "/api/experiments",
    errorEnvelope: "legacy",
  });

  type ExperimentContext = ProjectScopedContext<EndpointVariables>;

  const listHandler = async (
    c: ExperimentContext,
    input: z.infer<typeof listExperimentsQuerySchema>,
  ) => {
    const project = projectOf(c);
    const { page, pageSize } = input;

    logger.info({ projectId: project.id, page, pageSize }, "Listing experiments");

    const { experiments: paged, totalHits } = await app().getPage({
      projectId: project.id,
      page,
      pageSize,
    });

    // What an experiment nobody has run aggregates to is the application's
    // answer, not this family's; the read route below asks the same question
    // and gets the same one.
    const withRuns = await app().withRunAggregates({
      projectId: project.id,
      experiments: paged,
    });

    const offset = (page - 1) * pageSize;
    return {
      experiments: withRuns.map(toExperimentSummary),
      pagination: {
        page,
        pageSize,
        totalHits,
        hasMore: offset + paged.length < totalHits,
      },
    };
  };

  const getHandler = async (c: ExperimentContext, input: z.infer<typeof slugParamsSchema>) => {
    const project = projectOf(c);

    // Slug first, because that is what the list route returns as `slug` and
    // what every sibling route in this namespace takes. The id is accepted too
    // rather than refused, since the same list row carries both and a caller
    // reaching for `id` is not making a mistake worth a 404.
    const experiment = await app().getBySlugOrId({
      projectId: project.id,
      slugOrId: input.slug,
    });

    const [withRuns] = await app().withRunAggregates({
      projectId: project.id,
      experiments: [experiment],
    });

    // One experiment in means one row out; the application answers for an
    // experiment with no runs rather than leaving a hole to fill here.
    return toExperimentSummary(withRuns!);
  };

  const createHandler = async (
    c: ExperimentContext,
    input: z.infer<typeof createExperimentBodySchema>,
  ) => {
    const project = projectOf(c);

    // A caller that sends no setup still gets a workbench they can open. The
    // default and the attribution are both the application's: they are
    // properties of creating an experiment, not of the credential it arrived
    // on.
    const created = await app().createEvaluationsV3(
      {
        projectId: project.id,
        ...(input.name ? { name: input.name } : {}),
        ...(input.state ? { state: input.state } : {}),
      },
      { kind: "credential", credential: credentialPrincipalOf(c) },
    );

    logger.info({ projectId: project.id, slug: created.slug }, "Experiment created over REST");

    return { id: created.experimentId, slug: created.slug, version: created.version };
  };

  return (
    service
      // Mirrors the canonical experiments-list permission: the tRPC procedures
      // that return this same project-scoped experiment list gate on
      // experiments:view.
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("experiments:view"))(b)
          .withQuery(listExperimentsQuerySchema)
          .withOutput(experimentsListResponseSchema)
          .withDocs({
            summary: "List experiments for the project",
            description:
              "List experiments for the project. Includes a runs count and last-run timestamp per experiment.",
            tags: ["Experiments"],
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: {
                  "application/json": { schema: resolver(experimentsListResponseSchema) },
                },
              },
            },
          }),
      )
      // Read one experiment, by the slug the list route just handed the caller.
      // `:slug` is a parameter segment at the root of a namespace whose
      // siblings are literal (`/runs`, `/runs/:runId`), and those live in the
      // v3 app, which mounts ahead of this one.
      .registerRoute("get", "/:slug", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("experiments:view"))(b)
          .withParams(slugParamsSchema)
          .withOutput(experimentSummarySchema)
          .withDocs({
            summary: "Read one experiment",
            description:
              "Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id as well, so either identifier the list hands back can be used.",
            tags: ["Experiments"],
            responses: {
              ...baseResponses,
              404: {
                description: "No experiment with that slug or id in this project",
                content: {
                  "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
                },
              },
              200: {
                description: "Success",
                content: {
                  "application/json": { schema: resolver(experimentSummarySchema) },
                },
              },
            },
          }),
      )
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("experiments:create"))(b)
          .withInput(createExperimentBodySchema)
          .withOutput(createExperimentResponseSchema)
          .withDocs({
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
                  "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
                },
              },
              200: {
                description: "Experiment created",
                content: {
                  "application/json": { schema: resolver(createExperimentResponseSchema) },
                },
              },
            },
          }),
      )
      .build()
  );
}
