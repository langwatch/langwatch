/**
 * `/api/experiments/execute` and `/api/experiments/abort` - the two workbench
 * doors a BROWSER opens, behind the session door. The project a run names
 * resolves `evaluations:manage` from the project in the body before either operation.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import {
  abortExperimentRunRequestSchema,
  abortExperimentRunResponseSchema,
  executionRequestSchema,
} from "@langwatch/experiment-contract";

import { ExperimentV3RestApi, rawAnswerOf } from "./experiment-v3.rest.ts";

export const experimentWorkbenchRunRest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")

  // ── POST /execute ──────────────────────────────────────────────────────
  // Kept out of the published document: no API client can present the browser
  // session this door opens on, so publishing it would document an endpoint
  // that answers 401 to everyone reading the reference.
  .post("/execute", "executeExperiment")
  .withInput(executionRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withRawResponse({ produces: "text/event-stream" })
  .withDocs({ hide: true })
  .handle(async ({ app, input, actor }): Promise<RestRawResult> =>
    rawAnswerOf(await app.executeWorkbenchRun(input, actor)),
  )

  // ── POST /abort ────────────────────────────────────────────────────────
  .post("/abort", "abortExperimentRun")
  .withInput(abortExperimentRunRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withOutput(abortExperimentRunResponseSchema)
  .withDocs({ hide: true })
  .handle(({ app, input }) => app.abortWorkbenchRun(input))

  .build();
