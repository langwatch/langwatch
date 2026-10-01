/** POST /api/experiment/init: find-or-create by slug; refusals are handled errors. */
import { PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
} from "@langwatch/api/rest";
import {
  ExperimentApi,
  experimentInitBodySchema,
  experimentInitResponseSchema,
} from "@langwatch/experiment-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** Retired: the project door resolves the caller. Kept while the package index re-exports it. */
export const experimentInitCaller = defineRestMiddleware(
  "experimentInitCaller",
  z.object({ projectId: z.string(), projectSlug: z.string() }),
);

export const experimentInitRest = defineRestRouter(ExperimentApi)
  .withNamespace("experiment")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/init", "postApiExperimentInit")
  .withInput(experimentInitBodySchema)
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withPermission("experiments:manage")
  .withOutput(experimentInitResponseSchema)
  .withDocs({
    tags: ["Experiments"],
    summary: "Create an experiment",
    description:
      "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you. The body carries `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and `workflowId` ties it to an Optimization Studio workflow.",
    errors: [
      { status: 400, description: "The body was not valid JSON" },
      { status: 401, description: "Missing or invalid API key" },
      {
        status: 403,
        description:
          "The API key lacks experiments:manage, or the plan's experiment limit is already reached",
      },
      { status: 413, description: "The body is larger than the deployment accepts" },
      {
        status: 422,
        description:
          "The body failed validation, or neither experiment_slug nor experiment_id was supplied",
      },
    ],
  })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, input, scope }, facts) => {
    // Both identifiers are forwarded: an id-only request used to pass
    // validation and then fail as a 500.
    const experiment = await app.findOrCreateForRun({
      projectId: scope.id,
      experimentId: input.experiment_id,
      experimentSlug: input.experiment_slug,
      experimentType: input.experiment_type,
      experimentName: input.experiment_name,
      workflowId: input.workflowId,
    });

    return {
      path: `/${facts.projectSlug}/experiments/${experiment.slug}`,
      slug: experiment.slug,
    };
  })

  .build();
