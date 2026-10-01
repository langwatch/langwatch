/**
 * `/api/experiments` - the list, one row, and the create that starts a
 * workbench, over a standard project key. The create's attributed credential
 * is a bound fact, not a reach into the framework's context.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  createExperimentBodySchema,
  createExperimentResponseSchema,
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

/** Every operation in this family is filed under one tag. */
const EXPERIMENT_TAGS = ["Experiments"] as const;

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
  .get("/", "getApiExperiments")
  .withQuery(listExperimentsQuerySchema)
  .withPermission("experiments:view")
  .withOutput(experimentsListResponseSchema)
  .withDocs({
    tags: EXPERIMENT_TAGS,
    summary: "List experiments for the project",
    description:
      "List experiments for the project. Includes a runs count and last-run timestamp per experiment.",
  })
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
  .get("/:slug", "getApiExperimentsBySlug")
  .withParams(slugParamsSchema)
  .withPermission("experiments:view")
  .withOutput(experimentSummarySchema)
  .withDocs({
    tags: EXPERIMENT_TAGS,
    summary: "Read one experiment",
    description:
      "Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id as well, so either identifier the list hands back can be used.",
    errors: [{ status: 404, description: "No experiment with that slug or id in this project" }],
  })
  .handle(async ({ app, input, scope }) => {
    const experiment = await app.getBySlugOrId({
      projectId: scope.id,
      slugOrId: input.slug,
    });
    const [withRuns] = await app.withRunAggregates({
      projectId: scope.id,
      experiments: [experiment],
    });

    // One experiment in means one row out; the application answers for an
    // experiment with no runs rather than leaving a hole to fill here.
    return summaryOf(withRuns ?? { experiment, runsCount: 0, lastRunAt: null });
  })

  .post("/", "postApiExperiments")
  .withInput(createExperimentBodySchema)
  .withPermission("experiments:create")
  .withOutput(createExperimentResponseSchema)
  .withDocs({
    tags: EXPERIMENT_TAGS,
    summary: "Create an experiment and its setup",
    description:
      "Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench with one inline dataset. The slug it answers with is what every other experiment endpoint takes.",
    errors: [
      {
        status: 400,
        description:
          "The setup did not match the schema (experiment_invalid_workbench_state) or points at something that no longer exists (experiment_workbench_missing_reference)",
      },
    ],
  })
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
