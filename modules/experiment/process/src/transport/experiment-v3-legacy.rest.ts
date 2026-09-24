/**
 * `/api/evaluations/v3/*` - the older name of the `/api/experiments` workbench doors, which the
 * Python and TypeScript SDKs still call. Same operations, permissions, doors and bodies; kept out
 * of the published document, as main kept it.
 */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestRawResult,
} from "@langwatch/api/rest";
import {
  abortExperimentRunRequestSchema,
  abortExperimentRunResponseSchema,
  evaluationSlugParamsSchema,
  evaluationSlugVersionParamsSchema,
  executionRequestSchema,
  listRunsQuerySchema,
  listRunsResponseSchema,
  listVersionsQuerySchema,
  listWorkbenchVersionsResponseSchema,
  restoreWorkbenchVersionBodySchema,
  restoreWorkbenchVersionResponseSchema,
  runIdParamsSchema,
  runRefusalSchema,
  runResultsQuerySchema,
  runResultsResponseSchema,
  runStatusResponseSchema,
  saveWorkbenchStateBodySchema,
  saveWorkbenchStateResponseSchema,
  workbenchStateAnswerSchema,
  workbenchStateQuerySchema,
} from "@langwatch/experiment-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";

import {
  experimentWorkbenchCredential,
  ExperimentV3RestApi,
  rawAnswerOf,
} from "./experiment-v3.rest.ts";

const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const HIDDEN = { hide: true } as const;

export const experimentV3LegacyRest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("evaluations")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-in-path", { generation: "v3" })

  .post("/:evaluationSlug/run", "postApiEvaluationsV3BySlugRun")
  .withParams(evaluationSlugParamsSchema)
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withPermission("evaluations:create")
  .withRawResponse({ produces: ["application/json", "text/event-stream"] })
  .withDocs(HIDDEN)
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(
    async ({ app, input, raw, request, scope }, project, credential): Promise<RestRawResult> =>
      rawAnswerOf(
        await app.startSavedRun({
          projectId: scope.id,
          projectSlug: project.projectSlug,
          slug: input.evaluationSlug,
          body: raw,
          acceptsEvents: (request.headers.get("Accept") ?? "").includes("text/event-stream"),
          credential,
        }),
      ),
  )

  .get("/runs", "getApiEvaluationsV3Runs")
  .withQuery(listRunsQuerySchema)
  .withPermission("evaluations:view")
  .responds({ 200: listRunsResponseSchema, 400: runRefusalSchema })
  .withDocs(HIDDEN)
  .handle(({ app, input, scope }) => app.listRunsPage({ ...input, projectId: scope.id }))

  .get("/runs/:runId", "getApiEvaluationsV3RunsByRunId")
  .withParams(runIdParamsSchema)
  .withPermission("evaluations:view")
  .withOutput(runStatusResponseSchema)
  .withDocs(HIDDEN)
  .handle(({ app, input, scope }) => app.pollRun({ projectId: scope.id, runId: input.runId }))

  .get("/runs/:runId/results", "getApiEvaluationsV3RunsByRunIdResults")
  .withParams(runIdParamsSchema)
  .withQuery(runResultsQuerySchema)
  .withPermission("evaluations:view")
  .withOutput(runResultsResponseSchema)
  .withDocs(HIDDEN)
  .handle(({ app, input, scope }) => app.readRunResults({ ...input, projectId: scope.id }))

  .get("/:evaluationSlug/workbench-state", "getApiEvaluationsV3BySlugWorkbenchState")
  .withParams(evaluationSlugParamsSchema)
  .withQuery(workbenchStateQuerySchema)
  .withPermission("experiments:view")
  .withOutput(workbenchStateAnswerSchema)
  .withDocs(HIDDEN)
  .handle(({ app, input, scope }) =>
    app.readWorkbenchStateBySlug({
      projectId: scope.id,
      slug: input.evaluationSlug,
      fields: input.fields,
    }),
  )

  .put("/:evaluationSlug/workbench-state", "putApiEvaluationsV3BySlugWorkbenchState")
  .withParams(evaluationSlugParamsSchema)
  .withInput(saveWorkbenchStateBodySchema)
  .withPermission("experiments:update")
  .withOutput(saveWorkbenchStateResponseSchema)
  .withDocs(HIDDEN)
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(({ app, input: { evaluationSlug, ...body }, scope }, _project, credential) =>
    app.saveWorkbenchStateBySlug(
      { ...body, projectId: scope.id, slug: evaluationSlug },
      { kind: "credential", credential },
    ),
  )

  .get("/:evaluationSlug/versions", "getApiEvaluationsV3BySlugVersions")
  .withParams(evaluationSlugParamsSchema)
  .withQuery(listVersionsQuerySchema)
  .withPermission("experiments:view")
  .withOutput(listWorkbenchVersionsResponseSchema)
  .withDocs(HIDDEN)
  .handle(({ app, input: { evaluationSlug, ...query }, scope }) =>
    app.listWorkbenchVersionsBySlug({ ...query, projectId: scope.id, slug: evaluationSlug }),
  )

  .post(
    "/:evaluationSlug/versions/:version/restore",
    "postApiEvaluationsV3BySlugVersionsByVersionRestore",
  )
  .withParams(evaluationSlugVersionParamsSchema)
  .withPermission("experiments:update")
  .withInput(restoreWorkbenchVersionBodySchema)
  .withOutput(restoreWorkbenchVersionResponseSchema)
  .withDocs(HIDDEN)
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(async ({ app, input, scope }, _project, credential) => ({
    version: (
      await app.restoreWorkbenchVersionBySlug(
        { projectId: scope.id, slug: input.evaluationSlug, version: input.version },
        { kind: "credential", credential },
      )
    ).version,
  }))

  .build();

/** The two browser-session doors main's alias forwarded as well. */
export const experimentWorkbenchRunLegacyRest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("evaluations")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-in-path", { generation: "v3" })
  .withCredential("browser")

  .post("/execute", "executeEvaluationsV3Experiment")
  .withInput(executionRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withRawResponse({ produces: "text/event-stream" })
  .withDocs(HIDDEN)
  .handle(async ({ app, input, actor }): Promise<RestRawResult> =>
    rawAnswerOf(await app.executeWorkbenchRun(input, actor)),
  )

  .post("/abort", "abortEvaluationsV3ExperimentRun")
  .withInput(abortExperimentRunRequestSchema)
  .withPermission("evaluations:manage", { at: "route", param: "projectId" })
  .withOutput(abortExperimentRunResponseSchema)
  .withDocs(HIDDEN)
  .handle(({ app, input }) => app.abortWorkbenchRun(input))

  .build();
