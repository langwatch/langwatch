/**
 * The experiment WORKBENCH's ten REST doors: the run it starts, the run it
 * stops, the three ways a run is read back, and the four the saved setup is
 * read and written through - plus the `/api/evaluations/v3` alias that
 * re-dispatches into them.
 *
 * This family mixes two credential kinds under one path (a browser session
 * for `execute`/`abort`, a project API key for the other eight), which
 * `defineRestRouter`'s one-door-per-namespace model cannot express. Every
 * route therefore declares `deferredScope` and resolves its own caller
 * through `app`, exactly as `experiment-init.rest.ts` does for its one door.
 * `app` is this family's OWN token, not `ExperimentApi`: it has no installed
 * module (like `AuthDoorApi`), so the process composes an object satisfying
 * it directly. Spec: modules/experiment/specs/experiment-service.feature.
 */
import { deferredScope, publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
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
  type WorkbenchCredential,
  ExperimentVersionNotFoundError,
  InvalidExperimentConfigurationError,
  createInitialUIState,
  executionRequestSchema,
  persistedEvaluationsV3StateSchema,
  runInputsBodySchema,
  runsSavedDataset,
  type EvaluationsV3State,
  type ExecutionScope,
} from "@langwatch/experiment-contract";
import { z } from "zod";

import type { ExperimentApp } from "#app/experiment.app";
import type { ExperimentRunProgressPort } from "../ports/experiment-run-progress.port.ts";
import { ExperimentRunOrchestratorService } from "../services/experiment-run-orchestrator.service.ts";
import type { ExperimentRunPorts } from "../rules/experiment-run-input.rules.ts";
import type { StartPollingRunInput } from "../services/experiment-polling-run.service.ts";
import { ExperimentSavedStateExecutionService } from "../services/experiment-saved-state-execution.service.ts";
import {
  type ExecutionDataServices,
  ExperimentExecutionDataService,
} from "../services/experiment-execution-data.service.ts";
import { ExperimentRunResultsWriterService } from "../services/experiment-run-results-writer.service.ts";
import { ExperimentRunStateMirrorService } from "../services/experiment-run-state-mirror.service.ts";
import { mapThrownErrorEvent } from "../processes/experiment-result-mapping.process.ts";
import { workbenchActorFrom } from "../rules/experiment-workbench-actor.rules.ts";

const logger = createLogger("langwatch:experiments-v3");

/** The signed-in person the two workbench-run doors read. */
export type ExperimentV3RestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** A resolved project credential, or the refusal to answer in its place. */
export type ExperimentV3RestCredential =
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string; slug: string }>;
      credential: WorkbenchCredential | null;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: number; body: object }>;

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
  progress: ExperimentRunProgressPort | null;
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
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<ExperimentV3RestSession | null>;
  /** Whether that session holds one permission on one project. */
  probeProjectPermission(
    session: ExperimentV3RestSession,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /** Resolves the request's project key and enforces one permission as its ceiling. */
  authenticateCredential(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ExperimentV3RestCredential>;
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
 * A route that authenticates in its own handler answers its own statuses, written through
 * rather than validated against one success schema; each states its 200 body in its own words.
 */
const SESSION_REASON =
  "the process's session port resolves the signed-in person and this handler checks " +
  "evaluations:manage on the project the request body names, including the two doors that " +
  "stream server-sent events";
const READ_REASON =
  "the process's credential port resolves the project this key may act in and enforces " +
  "evaluations:view as its ceiling before the handler runs";
const RUN_REASON =
  "the process's credential port resolves the project this key may act in and enforces " +
  "evaluations:create as its ceiling before the handler runs";
const EXPERIMENTS_VIEW_REASON =
  "the process's credential port resolves the project this key may act in and enforces " +
  "experiments:view as its ceiling before the handler runs";
const EXPERIMENTS_UPDATE_REASON =
  "the process's credential port resolves the project this key may act in and enforces " +
  "experiments:update as its ceiling before the handler runs";

/** A JSON answer this door writes itself. */
const jsonAnswer = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
function requireRunLoop(run: ExperimentV3RunLoop): {
  ports: ExperimentRunPorts;
  progress: ExperimentRunProgressPort;
} {
  if (!run.ports || !run.progress) {
    throw new ExperimentRunLoopUnavailableError("experiment run loop");
  }
  return { ports: run.ports, progress: run.progress };
}

/** The person behind a session door, or the refusal in their place. */
async function requireSession(
  app: ExperimentV3RestApi,
  request: Request,
  projectId: string,
  permission: AuthzPermission,
): Promise<ExperimentV3RestSession | Response> {
  const session = await app.resolveSession(request);
  if (!session) {
    return jsonAnswer({ error: "You must be logged in to access this endpoint." }, 401);
  }
  if (!(await app.probeProjectPermission(session, projectId, permission))) {
    return jsonAnswer({ error: "You do not have permission to access this endpoint." }, 403);
  }
  return session;
}

export const experimentV3Rest = defineRestRouter(ExperimentV3RestApi)
  .withNamespace("experiments")
  .withVersion(MANAGEMENT_API_VERSION)

  // ── POST /execute ──────────────────────────────────────────────────────
  // Kept out of the published document. The route authenticates with a
  // browser session and streams workbench UI state, so an API-key caller has
  // no way to reach it; publishing it would document an endpoint that
  // answers 401 to everyone reading the reference.
  .post("/execute", "executeExperiment")
  .withInput(executionRequestSchema)
  .withAccess(deferredScope({ reason: SESSION_REASON }))
  .withRawResponse({ produces: "text/event-stream" })
  .withDocs({ hide: true })
  .handle(async ({ app, input, request }): Promise<RestRawResult> => {
    const { projectId } = input;

    logger.info({ projectId, scope: input.scope }, "Starting experiment execution");

    const session = await requireSession(app, request, projectId, "evaluations:manage");
    if (session instanceof Response) return session;

    const { ports: runPorts, progress } = requireRunLoop(app.run);

    const dataResult = await ExperimentExecutionDataService.loadExecutionData(
      projectId,
      input.dataset,
      input.targets,
      input.evaluators,
      app.run.services,
      { data: input.data, datasetId: input.dataset_id, parameters: input.parameters },
    );

    if ("error" in dataResult) {
      return jsonAnswer({ error: dataResult.error }, dataResult.status);
    }

    const {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = dataResult;

    const state: EvaluationsV3State = {
      name: input.name,
      // The wire's column `type` is a plain string and the state's is the
      // narrowed union, which is the same widening the two casts below
      // already carry.
      datasets: [input.dataset as EvaluationsV3State["datasets"][number]],
      activeDatasetId: input.dataset.id ?? "dataset-1",
      targets: input.targets as EvaluationsV3State["targets"],
      evaluators: input.evaluators as EvaluationsV3State["evaluators"],
      results: {
        status: "running",
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      },
      pendingSavedChanges: {},
      ui: createInitialUIState(),
    };

    const mirror = ExperimentRunStateMirrorService.create({
      projectId,
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug ?? "",
      progress,
    });

    // The page saves these cells too, and it is the faster of the two. The
    // server writes them so the board does not depend on the tab surviving.
    const resultsWriter = ExperimentRunResultsWriterService.tryWriterFor({
      persistence: {
        experiments: app.experiments().experimentService,
        actor: { userId: session.user.id, label: "user" },
      },
      projectId,
      experimentId: input.experimentId,
      scope: input.scope,
      data: input.data,
      datasetId: input.dataset_id,
      parameters: input.parameters,
    });

    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
      body: executeEventStream({
        app,
        projectId,
        input,
        state,
        datasetRows,
        datasetColumns,
        loadedPrompts,
        loadedAgents,
        loadedEvaluators,
        loadedWorkflows,
        runPorts,
        mirror,
        resultsWriter,
        userId: session.user.id,
      }),
    };
  })

  // ── POST /abort ────────────────────────────────────────────────────────
  .post("/abort", "abortExperimentRun")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(deferredScope({ reason: SESSION_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    let body: { projectId?: string; runId?: string };
    try {
      body = JSON.parse(raw) as { projectId?: string; runId?: string };
    } catch {
      return jsonAnswer({ error: "Invalid request body" }, 400);
    }

    const { projectId, runId } = body;
    if (!projectId || !runId) {
      return jsonAnswer(
        { error: "Invalid request body", details: "projectId and runId are required" },
        400,
      );
    }

    const session = await requireSession(app, request, projectId, "evaluations:manage");
    if (session instanceof Response) return session;

    const { ports: runPorts, progress } = requireRunLoop(app.run);

    // The runId is attacker-controlled: verify it is owned by the authenticated project before
    // signaling an abort, or a caller could abort another tenant's run by guessing its id.
    const ownerProjectId =
      (await runPorts.abort.tryGetRunningProjectId(runId)) ??
      (await progress.tryGetRunState(runId))?.projectId;
    if (!ownerProjectId || ownerProjectId !== projectId) {
      throw new RunNotFoundError(runId);
    }

    logger.info({ projectId, runId }, "Requesting abort");
    await ExperimentRunOrchestratorService.requestAbort({ abort: runPorts.abort, runId });

    return jsonAnswer({ success: true, runId, message: "Abort requested" }, 200);
  })

  // ── POST /:slug/run  (CI/CD execution) ────────────────────────────────
  .post("/:slug/run", "runExperiment")
  .withParams(slugParamsSchema)
  // The body is read unparsed: an empty one is a full run, malformed JSON is
  // a 400 in this family's own words, and `runInputsBodySchema` parses what
  // is left.
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(deferredScope({ reason: RUN_REASON }))
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
  .handle(async ({ app, input, raw, request }): Promise<RestRawResult> => {
    const { slug } = input;

    // Starting a run CREATES a row; it doesn't administer the family, so this
    // asks for `:create`, not `:manage` - `:manage` still satisfies it
    // through the permission hierarchy.
    const credential = await app.authenticateCredential({
      request,
      permission: "evaluations:create",
    });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);

    const { project, credential: principal, markUsed } = credential;
    const experiments = app.experiments();

    const savedExperiment = await experiments.findBySlugAndType({
      projectId: project.id,
      slug,
      type: "EVALUATIONS_V3",
    });

    if (!savedExperiment) {
      throw new ExperimentNotFoundError(slug);
    }

    const parseResult = persistedEvaluationsV3StateSchema.safeParse(savedExperiment.workbenchState);
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
      projectId: project.id,
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

    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };

    const carriedOverCells = ExperimentSavedStateExecutionService.planSavedRunCarryOver({
      prepared,
      scope,
    });

    const isSSE = (request.headers.get("Accept") ?? "").includes("text/event-stream");

    logger.info(
      { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
      "Starting CI/CD experiment execution",
    );

    markUsed();

    if (isSSE) {
      const { ports: runPorts } = requireRunLoop(app.run);
      return {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: runEventStream({
          app,
          projectId: project.id,
          experimentId: experiment.id,
          slug,
          scope,
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
      projectId: project.id,
      projectSlug: project.slug,
      experimentId: experiment.id,
      experimentSlug: slug,
      scope,
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
              actor: workbenchActorFrom({ credential: principal }),
            },
          }
        : {}),
    });

    return jsonAnswer({ runId, status: "running", total, runUrl }, 200);
  })

  // ── GET /runs?experimentSlug=... (list runs for an experiment) ────────
  .get("/runs", "listExperimentRuns")
  .withQuery(listRunsQuerySchema)
  .withAccess(deferredScope({ reason: READ_REASON }))
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
  .handle(async ({ app, input, request }) => {
    const credential = await app.authenticateCredential({ request, permission: "evaluations:view" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project } = credential;

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
      .getRunsPageBySlug({ projectId: project.id, experimentSlug, page, pageSize })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "experiment_not_found") {
          throw new ExperimentNotFoundError(experimentSlug);
        }
        throw error;
      });

    const offset = (page - 1) * pageSize;
    credential.markUsed();

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
  .withAccess(deferredScope({ reason: READ_REASON }))
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
  .handle(async ({ app, input, request }) => {
    const { runId } = input;

    const credential = await app.authenticateCredential({ request, permission: "evaluations:view" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, markUsed } = credential;
    const { progress } = requireRunLoop(app.run);

    const runState = await progress.tryGetRunState(runId);

    // All three not-found branches raise the SAME code: from outside they
    // are one answer - this run is not yours to read.
    if (!runState || runState.projectId !== project.id) {
      throw new RunNotFoundError(runId);
    }

    // Same archive guard as /runs/:runId/results: a run whose owning
    // experiment was archived must not keep serving status from the cache.
    if (runState.experimentId) {
      const stillLive = await app
        .experiments()
        .isActive({ projectId: project.id, id: runState.experimentId });
      if (!stillLive) throw new RunNotFoundError(runId);
    }

    logger.debug({ runId, status: runState.status }, "Run status queried");
    markUsed();

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
  .withAccess(deferredScope({ reason: READ_REASON }))
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
  .handle(async ({ app, input, request }) => {
    const { runId } = input;

    const credential = await app.authenticateCredential({ request, permission: "evaluations:view" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, markUsed } = credential;
    const { progress } = requireRunLoop(app.run);
    const experiments = app.experiments();

    const runState = await progress.tryGetRunState(runId);
    const slugFromState =
      runState && runState.projectId === project.id ? runState.experimentSlug : undefined;
    const experimentIdFromState =
      runState && runState.projectId === project.id ? runState.experimentId : undefined;

    const experimentSlug = input.experimentSlug ?? slugFromState;
    let experimentId = experimentIdFromState;

    if (!experimentId && experimentSlug) {
      const experiment = await experiments.findIdBySlug({ projectId: project.id, slug: experimentSlug });
      experimentId = experiment?.id;
    } else if (experimentId) {
      const stillLive = await experiments.isActive({ projectId: project.id, id: experimentId });
      if (!stillLive) experimentId = undefined;
    }

    if (!experimentId) {
      throw new RunNotFoundError(runId);
    }

    try {
      const run = await experiments.findRun({ projectId: project.id, experimentId, runId });
      if (!run) throw new RunNotFoundError(runId);

      markUsed();
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
  .withAccess(deferredScope({ reason: EXPERIMENTS_VIEW_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    summary: "Read an experiment's setup",
    description:
      "The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask for `fields=version` to check for changes without transferring the setup.",
    tags: ["Experiments"],
    responses: {
      400: { description: "The experiment is not an evaluations workbench (experiment_type_mismatch)" },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
    },
  })
  .handle(async ({ app, input, request }) => {
    const { slug } = input;

    const credential = await app.authenticateCredential({ request, permission: "experiments:view" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, markUsed } = credential;

    const workbench = await app.experiments().getWorkbenchState({ projectId: project.id, slug });
    markUsed();

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
  .withAccess(deferredScope({ reason: EXPERIMENTS_UPDATE_REASON }))
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
  .handle(async ({ app, input, request }) => {
    const { slug } = input;

    const credential = await app.authenticateCredential({ request, permission: "experiments:update" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, credential: principal, markUsed } = credential;

    const saved = await app.experiments().saveWorkbenchState(
      {
        projectId: project.id,
        slug,
        state: input.state,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
      },
      { kind: "credential", credential: principal },
    );

    markUsed();
    return jsonAnswer({ version: saved.version }, 200);
  })

  // ── GET /:slug/versions ─────────────────────────────────────────────
  .get("/:slug/versions", "listExperimentWorkbenchVersions")
  .withParams(slugParamsSchema)
  .withQuery(listVersionsQuerySchema)
  .withAccess(deferredScope({ reason: EXPERIMENTS_VIEW_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    summary: "List an experiment's versions",
    description:
      "Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with `autoSaved` true. Page through them with `limit` and `cursor`.",
    tags: ["Experiments"],
    responses: {
      400: { description: "The experiment is not an evaluations workbench (experiment_type_mismatch)" },
      401: { description: "Missing or invalid API key, or the key lacks the permission" },
      404: { description: "No such experiment in this project" },
    },
  })
  .handle(async ({ app, input, request }) => {
    const { slug } = input;

    const credential = await app.authenticateCredential({ request, permission: "experiments:view" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, markUsed } = credential;

    const experiments = app.experiments();
    const workbench = await experiments.getWorkbenchState({ projectId: project.id, slug });

    const { versions, nextCursor } = await experiments.listWorkbenchVersions({
      projectId: project.id,
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

    markUsed();

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
  .withAccess(deferredScope({ reason: EXPERIMENTS_UPDATE_REASON }))
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
  .handle(async ({ app, input, request }) => {
    const { slug, version } = input;

    const credential = await app.authenticateCredential({ request, permission: "experiments:update" });
    if (!credential.ok) return jsonAnswer(credential.body, credential.status);
    const { project, credential: principal, markUsed } = credential;

    const experiments = app.experiments();
    const workbench = await experiments.getWorkbenchState({ projectId: project.id, slug });

    // A path segment that is not a version number names a version this
    // experiment never had, which is the same answer as a number it never
    // had. `version: 0` because no experiment version is ever 0.
    const parsedVersion = parseOptionalPositiveInt(version);
    if (parsedVersion === undefined) {
      throw new ExperimentVersionNotFoundError({ experimentId: workbench.experimentId, version: 0 });
    }

    const restored = await experiments.restoreWorkbenchVersion(
      { projectId: project.id, id: workbench.experimentId, version: parsedVersion },
      { kind: "credential", credential: principal },
    );

    logger.info(
      { projectId: project.id, slug, version: parsedVersion },
      "Experiment version restored over REST",
    );
    markUsed();

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

/**
 * The `execute` event stream: runs the orchestrator, mirrors every frame onto
 * the run store and the saved cells, and writes each one as an SSE frame.
 */
function executeEventStream(options: {
  app: ExperimentV3RestApi;
  projectId: string;
  input: z.infer<typeof executionRequestSchema>;
  state: EvaluationsV3State;
  datasetRows: unknown[];
  datasetColumns: unknown;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators: unknown;
  loadedWorkflows: unknown;
  runPorts: ExperimentRunPorts;
  mirror: ReturnType<typeof ExperimentRunStateMirrorService.create>;
  resultsWriter: ReturnType<typeof ExperimentRunResultsWriterService.tryWriterFor>;
  userId: string;
}): ReadableStream {
  const { app, projectId, input, mirror, resultsWriter, userId } = options;
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const write = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const isFullRun = input.scope.type === "full";

        const orchestrator = ExperimentRunOrchestratorService.runOrchestrator({
          projectId,
          experimentId: input.experimentId,
          scope: input.scope,
          state: options.state,
          datasetRows: options.datasetRows,
          datasetColumns: options.datasetColumns,
          loadedPrompts: options.loadedPrompts,
          loadedAgents: options.loadedAgents,
          ports: options.runPorts,
          workflows: app.run.workflows,
          loadedEvaluators: options.loadedEvaluators,
          loadedWorkflows: options.loadedWorkflows,
          defaultConcurrency: app.run.defaultConcurrency,
          concurrency: input.concurrency,
          seedTargetOutputs: input.seedTargetOutputs,
          carriedOverCells: input.carriedOverCells,
        });

        for await (const event of orchestrator) {
          // The board first, then the run store, then the customer.
          await resultsWriter?.record(event);
          await mirror.record(event);
          write(event);

          if (event.type === "done" || event.type === "stopped") {
            app.recordExperimentRan?.({
              userId,
              projectId,
              experimentId: input.experimentId,
              isFullRun,
            });
            break;
          }
        }
      } catch (error) {
        logger.error({ error, projectId }, "Orchestrator error");
        app.reportError?.(error, { projectId });

        const failure = mapThrownErrorEvent({ error });
        if (failure.type === "error") {
          await mirror.fail({
            code: failure.message,
            domainError: failure.domainError,
            traceId: failure.traceId,
          });
        }
        write(failure);
      } finally {
        controller.close();
      }
    },
  });
}

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
