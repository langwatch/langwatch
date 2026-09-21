import type { Agent as TypedAgent } from "@langwatch/agent-contract";
/**
 * `/api/experiments/*` - the workbench's project-keyed doors for the CI/CD
 * run, run reads and saved setup. Each route names its required permission,
 * so the handler receives an already-resolved scope, not a raw caller.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestRawResult,
} from "@langwatch/api/rest";
import {
  ExperimentNotFoundError,
  ExperimentRunNotFoundError as RunNotFoundError,
  ExperimentRunLoopUnavailableError,
  ExperimentVersionNotFoundError,
  InvalidExperimentConfigurationError,
  persistedEvaluationsV3StateSchema,
  runInputsBodySchema,
  runsSavedDataset,
  type CarriedOverCell,
  type EvaluationsV3State,
  type ExecutionScope,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/kernel/module-api";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ExperimentV3RunLoop } from "#app/experiment-workbench.members";
import type { ExperimentApp } from "#app/experiment.app";

import { mapThrownErrorEvent } from "../eventing/experiment-result-mapping.process.ts";
import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";
import type { LoadedExecutionData } from "../services/experiment-execution-data.service.ts";
import { ExperimentRunOrchestratorService } from "../services/experiment-run-orchestrator.service.ts";
import { ExperimentSavedStateExecutionService } from "../services/experiment-saved-state-execution.service.ts";

const logger = createLogger("langwatch:experiments-v3");

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
  abortWorkbenchRun(
    input: Readonly<{
      projectId: string;
      runId: string;
    }>,
  ): Promise<{ success: true; runId: string; message: "Abort requested" }>;
  /** The application the workbench's four setup doors answer from. */
  experiments(): ExperimentApp;
  /**
   * The run loop, as this process composed it. A call rather than a field:
   * a module's API exposes operations only (`LocalFeatureApi`), and a
   * field-valued collaborator read off one throws.
   */
  run(): ExperimentV3RunLoop;
  /**
   * Records that a person ran an experiment, where this process has somewhere to
   * record it.
   */
  recordExperimentRan?:
    | ((input: {
        userId: string;
        projectId: string;
        experimentId: string | undefined;
        isFullRun: boolean;
      }) => void)
    | undefined;
  /** Where an unnamed failure is reported. Best-effort. */
  reportError?: ((error: unknown, context: Record<string, unknown>) => void) | undefined;
}

export const ExperimentV3RestApi = moduleApi<ExperimentV3RestApi>()("experiment");

/** The refusal a run door answers where this process composed no run loop. */
/**
 * A JSON answer this door writes itself, rather than validating against one
 * success schema — each route states its 200 body in its own words.
 */
export const jsonAnswer = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
    z.object({ kind: z.literal("legacyProjectKey") }).strict(),
  ]),
);

/**
 * Query parameters and path segments that are optional positive integers, or
 * nothing.
 */
const parseOptionalPositiveInt = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const slugParamsSchema = z.object({ slug: z.string().min(1) });
const runIdParamsSchema = z.object({ runId: z.string().min(1) });
const slugVersionParamsSchema = z.object({
  slug: z.string().min(1),
  version: z.string().min(1),
});

/** A bad page number falls back rather than refusing; a missing slug 400s in the handler. */
const listRunsQuerySchema = z.object({
  experimentSlug: z.string().optional().describe("Slug of the experiment whose runs you want"),
  page: z.string().optional().describe("1-based page number"),
  pageSize: z.string().optional().describe("Runs per page, capped at 200"),
});

const runResultsQuerySchema = z.object({
  experimentSlug: z
    .string()
    .optional()
    .describe("Owning experiment. Required once the run has aged out of the status cache."),
});

const workbenchStateQuerySchema = z.object({
  fields: z
    .string()
    .optional()
    .describe("Set to `version` to answer with the version and timestamp only"),
});

const listVersionsQuerySchema = z.object({
  limit: z.string().optional().describe("Versions per page, capped at 100"),
  cursor: z.string().optional().describe("The `nextCursor` of the previous page"),
});

const saveWorkbenchStateBodySchema = z.object({
  state: z.record(z.string(), z.unknown()),
  expectedVersion: z.number().int().optional(),
  commitMessage: z.string().optional(),
});

/** The run loop, or the refusal a process without one owes the caller. Starting a run needs both halves. */
export function runLoopOf(run: ExperimentV3RunLoop): {
  ports: ExperimentRunCollaborators;
  progress: ExperimentRunProgressRepository;
} {
  if (!run.ports || !run.progress) {
    throw new ExperimentRunLoopUnavailableError("experiment run loop");
  }
  return { ports: run.ports, progress: run.progress };
}

/**
 * Where a run's progress is READ from. Only the progress half: a process that
 * composes the store but starts no runs of its own still answers a poll, and
 * gating that read on `ports` made every reader of a run a 503.
 */
export function runProgressOf(run: ExperimentV3RunLoop): ExperimentRunProgressRepository {
  if (!run.progress) throw new ExperimentRunLoopUnavailableError("experiment run progress store");

  return run.progress;
}

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
  .withRawResponse({ produces: ["application/json", "text/event-stream"] })
  .withDocs({
    summary: "Run an experiment",
    description:
      "Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send `Accept: text/event-stream` instead to stream progress events until the run finishes.",
    tags: ["Experiments"],
    responses: {
      400: {
        description:
          "The body was not valid JSON, failed input validation, or the experiment has no dataset configured",
      },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment or run in this project" },
    },
  })
  .withMiddleware(projectRestFacts, experimentWorkbenchCredential)
  .handle(
    async ({ app, input, raw, request, scope }, project, credential): Promise<RestRawResult> => {
      const { slug } = input;

      const experiments = app.experiments();

      const savedExperiment = await experiments.findBySlugAndType({
        projectId: scope.id,
        slug,
        type: "EVALUATIONS_V3",
      });

      if (!savedExperiment) {
        throw new ExperimentNotFoundError(slug);
      }

      const parseResult = persistedEvaluationsV3StateSchema.safeParse(
        savedExperiment.workbenchState,
      );
      if (!parseResult.success) {
        logger.error({ slug, errors: parseResult.error.issues }, "Invalid workbenchState");
        throw new InvalidExperimentConfigurationError(slug);
      }

      const workbenchState = parseResult.data;
      const dataset = workbenchState.datasets[0];
      if (!dataset) {
        return jsonAnswer({ error: "No dataset configured" }, 400);
      }

      let rawBody: unknown = {};
      if (raw.trim()) {
        try {
          rawBody = JSON.parse(raw);
        } catch {
          return jsonAnswer({ error: "Invalid JSON body" }, 400);
        }
      }
      const inputsParse = runInputsBodySchema.safeParse(rawBody);
      if (!inputsParse.success) {
        return jsonAnswer(
          { error: inputsParse.error.issues[0]?.message ?? "Invalid request body" },
          400,
        );
      }
      const runInputs = inputsParse.data;

      const prepared = await ExperimentSavedStateExecutionService.prepareSavedStateExecution({
        experiments: experiments.experimentService,
        services: app.run().services,
        projectId: scope.id,
        slug,
        runInputs: {
          data: runInputs.data,
          datasetId: runInputs.dataset_id,
          parameters: runInputs.parameters,
        },
      });

      if ("error" in prepared) {
        return jsonAnswer({ error: prepared.error }, prepared.status);
      }

      const {
        experiment,
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts,
        loadedAgents,
        loadedEvaluators,
        loadedWorkflows,
      } = prepared;

      const runScope: ExecutionScope = runInputs.row_indices
        ? { type: "rows", rowIndices: runInputs.row_indices }
        : { type: "full" };

      const carriedOverCells = ExperimentSavedStateExecutionService.planSavedRunCarryOver({
        prepared,
        scope: runScope,
      });

      const isSSE = (request.headers.get("Accept") ?? "").includes("text/event-stream");

      logger.info(
        { projectId: scope.id, slug, isSSE, rowCount: datasetRows.length },
        "Starting CI/CD experiment execution",
      );

      if (isSSE) {
        const { ports: runPorts } = runLoopOf(app.run());
        return {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
          body: runEventStream({
            app,
            projectId: scope.id,
            experimentId: experiment.id,
            slug,
            scope: runScope,
            state,
            datasetRows,
            datasetColumns,
            loadedPrompts,
            loadedAgents,
            loadedEvaluators,
            loadedWorkflows,
            runPorts,
            carriedOverCells,
          }),
        };
      }

      const { runId, runUrl, total } = await app.run().startRun({
        projectId: scope.id,
        projectSlug: project.projectSlug,
        experimentId: experiment.id,
        experimentSlug: slug,
        scope: runScope,
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
        loadedAgents: loadedAgents as Map<string, TypedAgent>,
        loadedEvaluators,
        loadedWorkflows,
        ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
        // A run of the saved dataset fills the cells the workbench shows.
        ...(runsSavedDataset(runInputs)
          ? {
              persistResults: {
                experiments: experiments.experimentService,
                actor: workbenchActorFrom({ credential }),
              },
            }
          : {}),
      });

      return jsonAnswer({ runId, status: "running", total, runUrl }, 200);
    },
  )

  // ── GET /runs?experimentSlug=... (list runs for an experiment) ────────
  .get("/runs", "getApiExperimentsRuns")
  .withQuery(listRunsQuerySchema)
  .withPermission("evaluations:view")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }) => {
    const { experimentSlug } = input;
    if (!experimentSlug) {
      return jsonAnswer({ error: "experimentSlug query parameter is required" }, 400);
    }

    const pageSize = (() => {
      const parsed = input.pageSize ? parseInt(input.pageSize, 10) : 50;
      if (!Number.isFinite(parsed) || parsed <= 0) return 50;
      return Math.min(parsed, 200);
    })();
    const page = (() => {
      const parsed = input.page ? parseInt(input.page, 10) : 1;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })();

    const { experiment, runs, totalHits } = await app
      .experiments()
      .getRunsPageBySlug({ projectId: scope.id, experimentSlug, page, pageSize })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "experiment_not_found") {
          throw new ExperimentNotFoundError(experimentSlug);
        }
        throw error;
      });

    const offset = (page - 1) * pageSize;

    return jsonAnswer(
      {
        experimentId: experiment.id,
        experimentSlug: experiment.slug,
        runs,
        pagination: { page, pageSize, totalHits, hasMore: offset + runs.length < totalHits },
      },
      200,
    );
  })

  // ── GET /runs/:runId (poll run status) ─────────────────────────────────
  .get("/runs/:runId", "getApiExperimentsRunsByRunId")
  .withParams(runIdParamsSchema)
  .withPermission("evaluations:view")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }) => {
    const { runId } = input;

    const progress = runProgressOf(app.run());

    const runState = await progress.findRunState(runId);

    // All three not-found branches raise the SAME code: from outside they
    // are one answer - this run is not yours to read.
    if (!runState || runState.projectId !== scope.id) {
      throw new RunNotFoundError(runId);
    }

    // Same archive guard as /runs/:runId/results: a run whose owning
    // experiment was archived must not keep serving status from the cache.
    if (runState.experimentId) {
      const stillLive = await app
        .experiments()
        .isActive({ projectId: scope.id, id: runState.experimentId });
      if (!stillLive) throw new RunNotFoundError(runId);
    }

    logger.debug({ runId, status: runState.status }, "Run status queried");

    if (runState.status === "running" || runState.status === "pending") {
      return jsonAnswer(
        {
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
        },
        200,
      );
    }

    if (runState.status === "completed") {
      return jsonAnswer(
        {
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
          finishedAt: runState.finishedAt,
          summary: runState.summary,
        },
        200,
      );
    }

    if (runState.status === "failed") {
      return jsonAnswer(
        {
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
          finishedAt: runState.finishedAt,
          // The code, never the thrown message (ADR-045).
          error: runState.error,
          ...(runState.domainError ? { domainError: runState.domainError } : {}),
          ...(runState.traceId ? { traceId: runState.traceId } : {}),
        },
        200,
      );
    }

    // stopped
    return jsonAnswer(
      {
        runId: runState.runId,
        status: runState.status,
        progress: runState.progress,
        total: runState.total,
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
      },
      200,
    );
  })

  // ── GET /runs/:runId/results (full per-row results) ─────────────────────
  .get("/runs/:runId/results", "getApiExperimentsRunsByRunIdResults")
  .withParams(runIdParamsSchema)
  .withQuery(runResultsQuerySchema)
  .withPermission("evaluations:view")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }) => {
    const { runId } = input;

    const progress = runProgressOf(app.run());
    const experiments = app.experiments();

    const runState = await progress.findRunState(runId);
    const slugFromState =
      runState && runState.projectId === scope.id ? runState.experimentSlug : undefined;
    const experimentIdFromState =
      runState && runState.projectId === scope.id ? runState.experimentId : undefined;

    const experimentSlug = input.experimentSlug ?? slugFromState;
    let experimentId = experimentIdFromState;

    if (!experimentId && experimentSlug) {
      const experiment = await experiments.findIdBySlug({
        projectId: scope.id,
        slug: experimentSlug,
      });
      experimentId = experiment?.id;
    } else if (experimentId) {
      const stillLive = await experiments.isActive({ projectId: scope.id, id: experimentId });
      if (!stillLive) experimentId = undefined;
    }

    if (!experimentId) {
      throw new RunNotFoundError(runId);
    }

    try {
      const run = await experiments.findRun({ projectId: scope.id, experimentId, runId });
      if (!run) throw new RunNotFoundError(runId);

      return jsonAnswer(run, 200);
    } catch (error) {
      // Only a genuine miss is a 404 (ADR-045).
      if (HandledError.isHandled(error)) throw error;
      logger.error({ error, runId }, "Failed to fetch run results");
      throw error;
    }
  })

  // ── GET /:slug/workbench-state ───────────────────────────────────────
  .get("/:slug/workbench-state", "getApiExperimentsBySlugWorkbenchState")
  .withParams(slugParamsSchema)
  .withQuery(workbenchStateQuerySchema)
  .withPermission("experiments:view")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }) => {
    const { slug } = input;

    const workbench = await app.experiments().getWorkbenchState({ projectId: scope.id, slug });

    const identity = {
      id: workbench.experimentId,
      slug: workbench.slug,
      version: workbench.version,
      updatedAt: workbench.updatedAt.toISOString(),
    };

    if (input.fields === "version") return jsonAnswer(identity, 200);

    return jsonAnswer({ ...identity, name: workbench.name, state: workbench.state }, 200);
  })

  // ── PUT /:slug/workbench-state ───────────────────────────────────────
  .put("/:slug/workbench-state", "putApiExperimentsBySlugWorkbenchState")
  .withParams(slugParamsSchema)
  .withInput(saveWorkbenchStateBodySchema)
  .withPermission("experiments:update")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }, _project, credential) => {
    const { slug } = input;

    const saved = await app.experiments().saveWorkbenchState(
      {
        projectId: scope.id,
        slug,
        state: input.state,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
      },
      { kind: "credential", credential },
    );

    return jsonAnswer({ version: saved.version }, 200);
  })

  // ── GET /:slug/versions ─────────────────────────────────────────────
  .get("/:slug/versions", "getApiExperimentsBySlugVersions")
  .withParams(slugParamsSchema)
  .withQuery(listVersionsQuerySchema)
  .withPermission("experiments:view")
  .withRawResponse({ produces: "application/json" })
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
  .handle(async ({ app, input, scope }) => {
    const { slug } = input;

    const experiments = app.experiments();
    const workbench = await experiments.getWorkbenchState({ projectId: scope.id, slug });

    const { versions, nextCursor } = await experiments.listWorkbenchVersions({
      projectId: scope.id,
      id: workbench.experimentId,
      ...(() => {
        const limit = parseOptionalPositiveInt(input.limit);
        return limit !== undefined ? { limit } : {};
      })(),
      ...(() => {
        const cursor = parseOptionalPositiveInt(input.cursor);
        return cursor !== undefined ? { cursor } : {};
      })(),
    });

    return jsonAnswer(
      {
        versions: versions.map((version) => ({
          version: version.version,
          counterVersion: version.counterVersion,
          autoSaved: version.autoSaved,
          commitMessage: version.commitMessage,
          authorLabel: version.authorLabel,
          authorId: version.authorId,
          createdAt: version.createdAt.toISOString(),
          updatedAt: version.updatedAt.toISOString(),
        })),
        nextCursor,
      },
      200,
    );
  })

  // ── POST /:slug/versions/:version/restore ────────────────────────────
  .post("/:slug/versions/:version/restore", "postApiExperimentsBySlugVersionsByVersionRestore")
  .withParams(slugVersionParamsSchema)
  .withPermission("experiments:update")
  .withRawResponse({ produces: "application/json" })
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
    const { slug, version } = input;

    const experiments = app.experiments();
    const workbench = await experiments.getWorkbenchState({ projectId: scope.id, slug });

    // A path segment that is not a version number names a version this
    // experiment never had, which is the same answer as a number it never
    // had. `version: 0` because no experiment version is ever 0.
    const parsedVersion = parseOptionalPositiveInt(version);
    if (parsedVersion === undefined) {
      throw new ExperimentVersionNotFoundError({
        experimentId: workbench.experimentId,
        version: 0,
      });
    }

    const restored = await experiments.restoreWorkbenchVersion(
      { projectId: scope.id, id: workbench.experimentId, version: parsedVersion },
      { kind: "credential", credential },
    );

    logger.info(
      { projectId: scope.id, slug, version: parsedVersion },
      "Experiment version restored over REST",
    );

    return jsonAnswer({ version: restored.version }, 200);
  })

  .build();

/** The `:slug/run` SSE stream: the same orchestrator, with no mirror or writer. */
function runEventStream(
  options: {
    app: ExperimentV3RestApi;
    projectId: string;
    experimentId: string;
    slug: string;
    scope: ExecutionScope;
    state: EvaluationsV3State;
    runPorts: ExperimentRunCollaborators;
    carriedOverCells: CarriedOverCell[];
  } & LoadedExecutionData,
): ReadableStream {
  const { app, projectId, slug } = options;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const write = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const orchestrator = ExperimentRunOrchestratorService.runOrchestrator({
          projectId,
          experimentId: options.experimentId,
          scope: options.scope,
          state: options.state,
          datasetRows: options.datasetRows,
          datasetColumns: options.datasetColumns,
          loadedPrompts: options.loadedPrompts,
          loadedAgents: options.loadedAgents,
          ports: options.runPorts,
          workflows: app.run().workflows,
          loadedEvaluators: options.loadedEvaluators,
          loadedWorkflows: options.loadedWorkflows,
          defaultConcurrency: app.run().defaultConcurrency,
          ...(options.carriedOverCells.length > 0
            ? { carriedOverCells: options.carriedOverCells }
            : {}),
        });

        for await (const event of orchestrator) {
          write(event);
          if (event.type === "done" || event.type === "stopped") break;
        }
      } catch (error) {
        logger.error({ error, projectId, slug }, "Orchestrator error");
        app.reportError?.(error, { projectId, slug });
        write(mapThrownErrorEvent({ error }));
      } finally {
        controller.close();
      }
    },
  });
}
