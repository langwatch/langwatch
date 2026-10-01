/**
 * `/api/experiments/*` - the workbench's project-keyed doors for the CI/CD
 * run, run reads and saved setup. Each route names its required permission,
 * so the handler receives an already-resolved scope, not a raw caller.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestAnswer,
  type RestEvent,
  type RestNegotiatedProducer,
} from "@langwatch/api/rest";
import {
  listRunsQuerySchema,
  listRunsResponseSchema,
  listVersionsQuerySchema,
  listWorkbenchVersionsResponseSchema,
  restoreWorkbenchVersionBodySchema,
  restoreWorkbenchVersionResponseSchema,
  runIdParamsSchema,
  runRefusalSchema,
  runResultsQuerySchema,
  runInputsBodySchema,
  runResultsResponseSchema,
  runStatusResponseSchema,
  saveWorkbenchStateBodySchema,
  saveWorkbenchStateResponseSchema,
  slugParamsSchema,
  slugVersionParamsSchema,
  startRunResponseSchema,
  workbenchStateQuerySchema,
  workbenchStateAnswerSchema,
  type EvaluationV3Event,
  type SavedRunAnswer,
} from "@langwatch/experiment-contract";
import { moduleApi } from "@langwatch/module";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ExperimentModule } from "#app/experiment.app";

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/**
 * Everything the workbench's ten doors reach that `ExperimentApi` does not
 * name: the session, api-key credential, run loop, and experiment application.
 * Composed by the process's `experiment-v3-rest.mount.ts` (not a module).
 */
export interface ExperimentV3RestApi {
  abortWorkbenchRun: ExperimentModule["abortWorkbenchRun"];
  startSavedRun: ExperimentModule["startSavedRun"];
  restoreWorkbenchVersionBySlug: ExperimentModule["restoreWorkbenchVersionBySlug"];
  readWorkbenchStateBySlug: ExperimentModule["readWorkbenchStateBySlug"];
  saveWorkbenchStateBySlug: ExperimentModule["saveWorkbenchStateBySlug"];
  listWorkbenchVersionsBySlug: ExperimentModule["listWorkbenchVersionsBySlug"];
  executeWorkbenchRun: ExperimentModule["executeWorkbenchRun"];
  listRunsPage: ExperimentModule["listRunsPage"];
  pollRun: ExperimentModule["pollRun"];
  readRunResults: ExperimentModule["readRunResults"];
}

export const ExperimentV3RestApi = moduleApi<ExperimentV3RestApi>()("experiment");

/** The resolved project credential used to attribute workbench writes. */
export const experimentWorkbenchCredential = defineRestMiddleware(
  "experimentWorkbenchCredential",
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("apiKey"),
        userId: z.string().nullable(),
        isLangySessionKey: z.boolean().optional(),
      })
      .strict(),
    z.object({ kind: z.literal("cliAccessToken"), userId: z.string() }).strict(),
    z.object({ kind: z.literal("legacyProjectKey") }).strict(),
  ]),
);

export const experimentV3Rest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)

  // ── POST /:slug/run  (CI/CD execution) ────────────────────────────────
  .post("/:slug/run", "postApiExperimentsBySlugRun")
  .withParams(slugParamsSchema)
  // The body is read unparsed: an empty one is a full run, malformed JSON is
  // a 400 in this family's own words, and `runInputsBodySchema` parses what
  // is left.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withPermission("evaluations:create")
  .withResponse("negotiated", {})
  .withDocs({
    summary: "Run an experiment",
    description:
      "Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send `Accept: text/event-stream` instead to stream progress events until the run finishes.",
    tags: ["Experiments"],
    requestBody: { schema: runInputsBodySchema, required: false },
    responses: {
      200: {
        description: "Run started",
        content: {
          ...documentedResponses({ 200: startRunResponseSchema })[200]?.content,
          "text/event-stream": {
            schema: {
              type: "string",
              description: "Progress events, ending with a done event carrying the summary",
            },
          },
        },
      },
      400: {
        description:
          "The body was not valid JSON, failed input validation, or the experiment has no dataset configured",
      },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment or run in this project" },
    },
  })
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(async ({ app, input, raw, response, scope }, project, credential) =>
    negotiatedRunAnswer(
      response,
      await app.startSavedRun({
        projectId: scope.id,
        projectSlug: project.projectSlug,
        slug: input.slug,
        body: raw,
        acceptsEvents: response.wantsEvents,
        credential,
      }),
    ),
  )

  // ── GET /runs?experimentSlug=... (list runs for an experiment) ────────
  .get("/runs", "getApiExperimentsRuns")
  .withQuery(listRunsQuerySchema)
  .withPermission("evaluations:view")
  .responds({ 200: listRunsResponseSchema, 400: runRefusalSchema })
  .withDocs({
    summary: "List runs of an experiment",
    description:
      "Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.",
    tags: ["Experiments"],
    responses: {
      400: { description: "experimentSlug was not supplied" },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
    },
  })
  .handle(({ app, input, scope }) =>
    app.listRunsPage({
      projectId: scope.id,
      experimentSlug: input.experimentSlug,
      page: input.page,
      pageSize: input.pageSize,
    }),
  )

  // ── GET /runs/:runId (poll run status) ─────────────────────────────────
  .get("/runs/:runId", "getApiExperimentsRunsByRunId")
  .withParams(runIdParamsSchema)
  .withPermission("evaluations:view")
  .withOutput(runStatusResponseSchema)
  .withDocs({
    summary: "Poll a run",
    description:
      "Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI job can poll this until `status` leaves `running`.",
    tags: ["Experiments"],
    responses: {
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such run in this project" },
    },
  })
  .handle(({ app, input, scope }) => app.pollRun({ projectId: scope.id, runId: input.runId }))

  // ── GET /runs/:runId/results (full per-row results) ─────────────────────
  .get("/runs/:runId/results", "getApiExperimentsRunsByRunIdResults")
  .withParams(runIdParamsSchema)
  .withQuery(runResultsQuerySchema)
  .withPermission("evaluations:view")
  .withOutput(runResultsResponseSchema)
  .withDocs({
    summary: "Read run results",
    description:
      "Every dataset row of a run with what the target predicted, plus one entry per evaluator per row. Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within its experiment.",
    tags: ["Experiments"],
    responses: {
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such run in this project" },
    },
  })
  .handle(({ app, input, scope }) =>
    app.readRunResults({
      projectId: scope.id,
      runId: input.runId,
      experimentSlug: input.experimentSlug,
    }),
  )

  // ── GET /:slug/workbench-state ───────────────────────────────────────
  .get("/:slug/workbench-state", "getApiExperimentsBySlugWorkbenchState")
  .withParams(slugParamsSchema)
  .withQuery(workbenchStateQuerySchema)
  .withPermission("experiments:view")
  .withOutput(workbenchStateAnswerSchema)
  .withDocs({
    summary: "Read an experiment's setup",
    description:
      "The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask for `fields=version` to check for changes without transferring the setup.",
    tags: ["Experiments"],
    responses: {
      400: {
        description: "The experiment is not an evaluations workbench (experiment_type_mismatch)",
      },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
    },
  })
  .handle(({ app, input, scope }) =>
    app.readWorkbenchStateBySlug({ projectId: scope.id, slug: input.slug, fields: input.fields }),
  )

  // ── PUT /:slug/workbench-state ───────────────────────────────────────
  .put("/:slug/workbench-state", "putApiExperimentsBySlugWorkbenchState")
  .withParams(slugParamsSchema)
  .withInput(saveWorkbenchStateBodySchema)
  .withPermission("experiments:update")
  .withOutput(saveWorkbenchStateResponseSchema)
  .withDocs({
    summary: "Save an experiment's setup",
    description:
      "Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is refused with a 409 when someone else wrote first, instead of overwriting their work.",
    tags: ["Experiments"],
    responses: {
      400: {
        description:
          "The setup did not match the schema (experiment_invalid_workbench_state), points at something that no longer exists (experiment_workbench_missing_reference), or the experiment is not an evaluations workbench (experiment_type_mismatch)",
      },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
      409: {
        description:
          "Someone else saved since you read this state (experiment_stale_workbench_state). `currentVersion` carries the version to read again.",
      },
    },
  })
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(({ app, input, scope }, _project, credential) =>
    app.saveWorkbenchStateBySlug(
      { ...input, projectId: scope.id },
      { kind: "credential", credential },
    ),
  )

  // ── GET /:slug/versions ─────────────────────────────────────────────
  .get("/:slug/versions", "getApiExperimentsBySlugVersions")
  .withParams(slugParamsSchema)
  .withQuery(listVersionsQuerySchema)
  .withPermission("experiments:view")
  .withOutput(listWorkbenchVersionsResponseSchema)
  .withDocs({
    summary: "List an experiment's versions",
    description:
      "Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with `autoSaved` true. Page through them with `limit` and `cursor`.",
    tags: ["Experiments"],
    responses: {
      400: {
        description: "The experiment is not an evaluations workbench (experiment_type_mismatch)",
      },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
    },
  })
  .handle(({ app, input, scope }) =>
    app.listWorkbenchVersionsBySlug({ ...input, projectId: scope.id }),
  )

  // ── POST /:slug/versions/:version/restore ────────────────────────────
  .post("/:slug/versions/:version/restore", "postApiExperimentsBySlugVersionsByVersionRestore")
  .withParams(slugVersionParamsSchema)
  .withPermission("experiments:update")
  .withInput(restoreWorkbenchVersionBodySchema)
  .withOutput(restoreWorkbenchVersionResponseSchema)
  .withDocs({
    summary: "Restore an experiment version",
    description:
      "Bring an old setup back by writing it forward as a new save. History is never rewritten: the version you restored from stays in the list, and the restore is one more entry after it.",
    tags: ["Experiments"],
    responses: {
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment or version in this project" },
      409: {
        description:
          "Someone else saved since you read this state (experiment_stale_workbench_state).",
      },
    },
  })
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(async ({ app, input, scope }, _project, credential) => {
    const restored = await app.restoreWorkbenchVersionBySlug(
      { projectId: scope.id, slug: input.slug, version: input.version },
      { kind: "credential", credential },
    );

    return { version: restored.version };
  })

  .build();

/** A run's progress as event-stream frames: one `data:` frame per event. */
export async function* runEventsOf(
  events: AsyncIterable<EvaluationV3Event>,
): AsyncIterable<RestEvent> {
  for await (const event of events) yield { data: JSON.stringify(event) };
}

/** A saved run's answer: the started run as JSON, or its progress as it happens. */
export function negotiatedRunAnswer(
  response: RestNegotiatedProducer,
  answer: SavedRunAnswer,
): RestAnswer<"negotiated"> {
  if (answer.kind === "started") {
    const { kind: _started, ...started } = answer;
    return response.json(started);
  }

  return response.events(runEventsOf(answer.events));
}
