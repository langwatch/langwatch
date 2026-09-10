/**
 * `/api/experiments/*` - the workbench's project-keyed doors: the CI/CD run,
 * the run reads and the saved setup. Every route names the permission its key
 * is measured against, so the door resolves the project and the handler is
 * handed the scope rather than authenticating the caller itself.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestRawResult,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { moduleApi } from "@langwatch/runtime-composition";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

import {
  ExperimentNotFoundError,
  ExperimentRunNotFoundError as RunNotFoundError,
  ExperimentVersionNotFoundError,
  InvalidExperimentConfigurationError,
  persistedEvaluationsV3StateSchema,
  runInputsBodySchema,
  runsSavedDataset,
  type EvaluationsV3State,
  type ExecutionScope,
} from "@langwatch/experiment-contract";
import { z } from "zod";

import type { ExperimentApp } from "#app/experiment.app";
import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import { ExperimentRunOrchestratorService } from "../services/experiment-run-orchestrator.service.ts";
import type { ExperimentRunPorts } from "../rules/experiment-run-input.rules.ts";
import type { StartPollingRunInput } from "../services/experiment-polling-run.service.ts";
import { ExperimentSavedStateExecutionService } from "../services/experiment-saved-state-execution.service.ts";
import type { ExecutionDataServices } from "../services/experiment-execution-data.service.ts";
import { mapThrownErrorEvent } from "../processes/experiment-result-mapping.process.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";

const logger = createLogger("langwatch:experiments-v3");

/** The signed-in person the two workbench-run doors read. */
export type ExperimentV3RestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/**
 * One polling run, as this transport asks for it: the run, and nothing about
 * the process it runs on.
 */
export type ExperimentV3StartRunInput = Omit<
  StartPollingRunInput,
  "ports" | "workflows" | "progress" | "baseUrl" | "defaultConcurrency"
> &
  Readonly<{ defaultConcurrency?: number }>;

/**
 * The run loop this process composed, or the holes where it did not.
 */
export type ExperimentV3RunLoop = Readonly<{
  ports: ExperimentRunPorts | null;
  progress: ExperimentRunProgressRepository | null;
  services: ExecutionDataServices;
  // `WorkflowService` is server-private to the workflow module; this transport
  // only forwards it into the orchestrator, so it is typed loosely rather than
  // naming that module's server package from here.
  workflows: unknown;
  defaultConcurrency: number;
  startRun(
    input: ExperimentV3StartRunInput,
  ): Promise<{ runId: string; runUrl: string; total: number }>;
}>;

/**
 * Everything the workbench's ten doors reach that `ExperimentApi` does not
 * name: the session, the api-key credential, the run loop, and the
 * experiment application both read and write through. Composed by the
 * process (`apps/api/src/features/experiment/experiment-v3-rest.mount.ts`)
 * because none of it is installed as a module.
 */
export interface ExperimentV3RestApi {
  /** Whether the signed-in person holds one permission on one project. */
  probeProjectPermission(
    session: ExperimentV3RestSession,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /** The application the workbench's four setup doors answer from. */
  experiments(): ExperimentApp;
  /** The run loop, as this process composed it. */
  run: ExperimentV3RunLoop;
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

export const ExperimentV3RestApi = moduleApi<ExperimentV3RestApi>("experiment");

/** The `/api/evaluations/v3` alias: the one thing it does is forward. */
export interface ExperimentV3AliasApi {
  forward(request: Request): Promise<Response>;
}

export const ExperimentV3AliasApi = moduleApi<ExperimentV3AliasApi>("experiment");

/** The refusal a run door answers where this process composed no run loop. */
export class ExperimentRunLoopUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ExperimentRunLoopUnavailableError";
  }
}

/**
 * A route that answers its own statuses writes them through rather than
 * validating them against one success schema; each states its 200 body in its
 * own words.
 *
 * A JSON answer this door writes itself.
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

/** The run loop, or the refusal a process without one owes the caller. */
export function runLoopOf(run: ExperimentV3RunLoop): {
  ports: ExperimentRunPorts;
  progress: ExperimentRunProgressRepository;
} {
  if (!run.ports || !run.progress) {
    throw new ExperimentRunLoopUnavailableError("experiment run loop");
  }
  return { ports: run.ports, progress: run.progress };
}

export const experimentV3Rest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)

  // ── POST /:slug/run  (CI/CD execution) ────────────────────────────────
  .post("/:slug/run", "runExperiment")
  .withParams(slugParamsSchema)
  // The body is read unparsed: an empty one is a full run, malformed JSON is
  // a 400 in this family's own words, and `runInputsBodySchema` parses what
  // is left.
  .withRawBody("text", { mediaType: "application/json" })
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
        services: app.run.services,
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
        const { ports: runPorts } = runLoopOf(app.run);
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

      const { runId, runUrl, total } = await app.run.startRun({
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
  .get("/runs", "listExperimentRuns")
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
  .get("/runs/:runId", "getExperimentRunStatus")
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

    const { progress } = runLoopOf(app.run);

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
  .get("/runs/:runId/results", "getExperimentRunResults")
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

    const { progress } = runLoopOf(app.run);
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
  .get("/:slug/workbench-state", "getExperimentWorkbenchState")
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
  .put("/:slug/workbench-state", "saveExperimentWorkbenchState")
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
  .get("/:slug/versions", "listExperimentWorkbenchVersions")
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
  .post("/:slug/versions/:version/restore", "restoreExperimentWorkbenchVersion")
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

/**
 * `/api/evaluations/v3/*` - the family's older name, re-dispatched. TERMINATES
 * NOTHING: the canonical route authenticates the forwarded request exactly as
 * a direct one.
 */
export const experimentV3AliasRest = defineRestRouter(ExperimentV3AliasApi)
  .withNamespace("evaluations-v3-alias")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .get("/api/evaluations/v3/*", "evaluationsV3Alias")
  .withAccess(
    publicRoute({
      reason:
        "the alias rewrites the path and hands the request to the canonical route, which " +
        "authenticates it exactly as it would a direct one",
    }),
  )
  .anyMethod()
  .withRawResponse({ produces: "application/json" })
  .handle(({ app, request }): Promise<Response> => {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/^\/api\/evaluations\/v3/, "/api/experiments");
    return app.forward(new Request(url.toString(), request));
  })

  .build();

/** The `:slug/run` SSE stream: the same orchestrator, with no mirror or writer. */
function runEventStream(options: {
  app: ExperimentV3RestApi;
  projectId: string;
  experimentId: string;
  slug: string;
  scope: ExecutionScope;
  state: EvaluationsV3State;
  datasetRows: unknown[];
  datasetColumns: unknown;
  loadedPrompts: unknown;
  loadedAgents: unknown;
  loadedEvaluators: unknown;
  loadedWorkflows: unknown;
  runPorts: ExperimentRunPorts;
  carriedOverCells: unknown[];
}): ReadableStream {
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
          loadedPrompts: options.loadedPrompts as Map<string, VersionedPrompt>,
          loadedAgents: options.loadedAgents as Map<string, TypedAgent>,
          ports: options.runPorts,
          workflows: app.run.workflows,
          loadedEvaluators: options.loadedEvaluators,
          loadedWorkflows: options.loadedWorkflows,
          defaultConcurrency: app.run.defaultConcurrency,
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
