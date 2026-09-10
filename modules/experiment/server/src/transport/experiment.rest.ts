/**
 * `/api/experiments` - the project's experiments over a standard project key:
 * the list, one row of it, and the create that starts a workbench.
 *
 * Everything a handler reaches is an operation on the api. The one thing the
 * request itself carries is the credential a create is attributed to, and that
 * arrives as a bound fact rather than as a reach into the framework's context.
 */
import { defineRestMiddleware, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  ExperimentApi,
  experimentsListResponseSchema,
  experimentSummarySchema,
  listExperimentsQuerySchema,
  slugParamsSchema,
  type Experiment,
  type ExperimentWithRuns,
  type WorkbenchCredential,
} from "@langwatch/experiment-contract";
import { Temporal, toEpochMs } from "@langwatch/time";
import { z } from "zod";

import {
  CREATE_EXPERIMENT,
  GET_EXPERIMENT,
  LIST_EXPERIMENTS,
} from "../rules/experiment-openapi.rules.ts";
import {
  createExperimentBodySchema,
  createExperimentResponseSchema,
} from "../rules/experiment-schemas.rules.ts";

/**
 * The credential the request arrived on, in the vocabulary the attribution
 * rule reads: a scoped key acts as the member it was minted for, a legacy
 * project key acts as nobody, and an agent's session key says so.
 */
export const experimentRestCredential = defineRestMiddleware(
  "experimentRestCredential",
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("apiKey"),
      userId: z.string().nullable(),
      isLangySessionKey: z.boolean().optional(),
    }),
    z.object({ kind: z.literal("legacyProjectKey") }),
  ]),
);

/** One experiment as every route in this family reports it. */
const summaryOf = ({ experiment, runsCount, lastRunAt }: ExperimentWithRuns) => ({
  id: experiment.id,
  slug: experiment.slug,
  name: experiment.name,
  type: experiment.type,
  workflowId: experiment.workflowId,
  createdAt: experiment.createdAt.toISOString(),
  updatedAt: experiment.updatedAt.toISOString(),
  runsCount,
  lastRunAt: lastRunAt
    ? Temporal.Instant.fromEpochMilliseconds(toEpochMs(lastRunAt)).toString({
        fractionalSecondDigits: 3,
      })
    : null,
});

export const experimentRest = defineRestRouter(ExperimentApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)

  // Mirrors the canonical experiments-list permission: the tRPC procedures
  // that return this same project-scoped list gate on experiments:view.
  .get("/", "listExperiments")
  .withQuery(listExperimentsQuerySchema)
  .withPermission("experiments:view")
  .withOutput(experimentsListResponseSchema)
  .withDocs(LIST_EXPERIMENTS)
  .handle(async ({ app, input, scope }) => {
    const { page, pageSize } = input;
    const { experiments: paged, totalHits } = await app.getPage({
      projectId: scope.id,
      page,
      pageSize,
    });

    // What an experiment nobody has run aggregates to is the application's
    // answer, not this family's; the read route below asks the same question
    // and gets the same one.
    const withRuns = await app.withRunAggregates({
      projectId: scope.id,
      experiments: paged as readonly Experiment[],
    });

    const offset = (page - 1) * pageSize;

    return {
      experiments: withRuns.map(summaryOf),
      pagination: {
        page,
        pageSize,
        totalHits,
        hasMore: offset + paged.length < totalHits,
      },
    };
  })

  // Read one experiment, by the slug the list route just handed the caller.
  // The id is accepted too rather than refused, since the same list row
  // carries both and a caller reaching for `id` is not making a mistake.
  .get("/:slug", "getExperiment")
  .withParams(slugParamsSchema)
  .withPermission("experiments:view")
  .withOutput(experimentSummarySchema)
  .withDocs(GET_EXPERIMENT)
  .handle(async ({ app, input, scope }) => {
    const experiment = await app.getBySlugOrId({ projectId: scope.id, slugOrId: input.slug });
    const [withRuns] = await app.withRunAggregates({
      projectId: scope.id,
      experiments: [experiment],
    });

    // One experiment in means one row out; the application answers for an
    // experiment with no runs rather than leaving a hole to fill here.
    return summaryOf(withRuns ?? { experiment, runsCount: 0, lastRunAt: null });
  })

  .post("/", "createExperiment")
  .withInput(createExperimentBodySchema)
  .withPermission("experiments:create")
  .withOutput(createExperimentResponseSchema)
  .withDocs(CREATE_EXPERIMENT)
  .withMiddleware(experimentRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    // A caller that sends no setup still gets a workbench they can open. The
    // default and the attribution are both the application's: they are
    // properties of creating an experiment, not of the credential it arrived on.
    const created = await app.createEvaluationsV3(
      {
        projectId: scope.id,
        ...(input.name ? { name: input.name } : {}),
        ...(input.state ? { state: input.state } : {}),
      },
      { kind: "credential", credential: credential as WorkbenchCredential },
    );

    return { id: created.experimentId, slug: created.slug, version: created.version };
  })

  .build();
