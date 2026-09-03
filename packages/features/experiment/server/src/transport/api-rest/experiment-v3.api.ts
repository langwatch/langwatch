/**
 * The experiment WORKBENCH's ten REST doors: the run it starts, the run it
 * stops, the three ways a run is read back, and the four the saved setup is
 * read and written through.
 *
 * `/api/experiments` is shared with the packaged experiment family next door,
 * which owns the bare list and create; this app owns everything under it that
 * the workbench and a CI job reach, and it is registered FIRST so its literal
 * `/runs` siblings are not swallowed by that family's `:slug`.
 *
 * ## Two credential classes, and why neither goes through the framework chain
 *
 * `/execute` and `/abort` are `credential: "session"` — the workbench streams
 * UI state to a browser, and the abort is authorized against the run's owner
 * rather than against a key. The other eight are `credential: "apiKey"`, and
 * they resolve the key themselves because the refusal they publish carries the
 * handled ceiling payload (code, permission, tips) that a CI job branches on.
 * Both arrive as ports so a process resolves a person and a key exactly once,
 * however many families ask.
 *
 * ## What is absent, and what each absence answers
 *
 * The RUN LOOP is a composition choice, not a fact of this package: a process
 * with no progress store cannot serve a poll, and one with no run ports cannot
 * start a stream. Rather than mount half a family, the four run routes refuse
 * BY NAME with `service_unavailable` and the four workbench routes — which need
 * nothing but the application — keep answering. That is the same split the
 * organization family's invitation half already records: a door that cannot
 * answer says so, instead of answering something a caller will act on.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type MountableRestApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Agent as TypedAgent } from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import {
  ExperimentNotFoundError,
  ExperimentRunNotFoundError as RunNotFoundError,
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
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, resolver } from "hono-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ExperimentApp } from "#app/experiment.app";
import type { ExperimentRunProgressPort } from "../../ports/experiment-run-progress.port";
import {
  requestAbort,
  runOrchestrator,
  type ExperimentRunPorts,
} from "../../services/experiment-run-orchestrator.service";
import type { StartPollingRunInput } from "../../services/experiment-polling-run.service";
import {
  planSavedRunCarryOver,
  prepareSavedStateExecution,
} from "../../services/experiment-saved-state-execution.service";
import {
  loadExecutionData,
  type ExecutionDataServices,
} from "../../services/experiment-execution-data.service";
import { runResultsWriterFor } from "../../services/experiment-run-results-writer.service";
import { createRunStateMirror } from "../../services/experiment-run-state-mirror.service";
import { mapThrownErrorEvent } from "../../processes/experiment-result-mapping.process";
import {
  handledErrorEnvelopeSchema,
  listRunsResponseSchema,
  listWorkbenchVersionsResponseSchema,
  restoreWorkbenchVersionResponseSchema,
  runResultsResponseSchema,
  runStatusResponseSchema,
  saveWorkbenchStateBodySchema,
  saveWorkbenchStateResponseSchema,
  staleWorkbenchStateErrorSchema,
  startRunResponseSchema,
  workbenchStateResponseSchema,
  workbenchVersionProbeResponseSchema,
} from "./experiment.schemas";
import { workbenchActorFrom } from "./experiment.workbench-actor";

const logger = createLogger("langwatch:experiments-v3");

/** The signed-in person the two workbench-run doors read. */
export type ExperimentV3RestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** A resolved project credential, or the refusal to answer in its place. */
export type ExperimentV3RestCredential =
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string; slug: string }>;
      resolved: Parameters<typeof workbenchActorFrom>[0]["resolved"];
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

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
 *
 * `ports` and `progress` are nullable together with intent: the orchestrator
 * needs the first to run a cell and the second to be polled afterwards, and a
 * process holding one without the other would start runs nothing can report on.
 */
export type ExperimentV3RunLoop = Readonly<{
  ports: ExperimentRunPorts | null;
  progress: ExperimentRunProgressPort | null;
  services: ExecutionDataServices;
  workflows: WorkflowService;
  defaultConcurrency: number;
  startRun(
    input: ExperimentV3StartRunInput,
  ): Promise<{ runId: string; runUrl: string; total: number }>;
}>;

/** What the workbench's ten doors reach that they do not own. */
export interface ExperimentV3RestPorts<TSession extends ExperimentV3RestSession> {
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds one permission on one project. */
  probeProjectPermission(
    session: TSession,
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
   * Records that a person ran an experiment, where this process has somewhere
   * to record it.
   *
   * Optional, and absent on a process with no product-analytics sink. A run
   * that completed must never fail because the adoption signal had nowhere to
   * go, so an absent sink is a signal not sent rather than a run not finished.
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
 * The errors these routes answer with.
 *
 * Both come out flat, but by different routes. A 404 is a thrown
 * `HandledError` (`ExperimentNotFoundError`, `RunNotFoundError`) that the
 * boundary serialises, so it carries the code in `error` plus the error's
 * `meta` spread alongside it. A 401 is answered by the credential port, which
 * forwards the full handled denial payload when there is one — the same open
 * shape covers both.
 */
const experimentErrorResponses = {
  401: {
    description: "Missing or invalid API key, or the key lacks the permission",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
  404: {
    description: "No such experiment or run in this project",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
};

/**
 * The answer every workbench route has for a slug that names another kind of
 * experiment, such as a DSPy run or a legacy batch evaluation.
 *
 * Only the workbench routes reach it. The run routes look the experiment up by
 * type, so for them the same slug is a 404 instead.
 */
const workbenchTypeErrorResponse = {
  400: {
    description: "The experiment is not an evaluations workbench (experiment_type_mismatch)",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
};

/**
 * The two extra answers a workbench WRITE has.
 *
 * A 409 means someone else saved on top of the state this caller read; its
 * `currentVersion` is what to read again. A 400 means the request was refused
 * before anything was written: the setup does not match the schema, it points
 * at a prompt, dataset or evaluator this project no longer has, or the slug
 * names another kind of experiment.
 */
const workbenchWriteErrorResponses = {
  400: {
    description:
      "The setup did not match the schema (experiment_invalid_workbench_state), points at something that no longer exists (experiment_workbench_missing_reference), or the experiment is not an evaluations workbench (experiment_type_mismatch)",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
  409: {
    description:
      "Someone else saved since you read this state (experiment_stale_workbench_state). `currentVersion` carries the version to read again.",
    content: {
      "application/json": {
        schema: resolver(staleWorkbenchStateErrorSchema),
      },
    },
  },
};

/**
 * Query parameters and path segments that are optional positive integers, or
 * nothing.
 *
 * The whole value has to be digits. `parseInt` reads the leading number and
 * discards the rest, so it turns `3abc` into 3 and `1.5` into 1: a mistyped
 * `/versions/3abc/restore` would then restore version 3 instead of answering
 * 404, which is a write the caller never asked for.
 */
const parseOptionalPositiveInt = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/** `/api/experiments/*` — the workbench's ten doors, bound to one process. */
export function createExperimentV3RestApp<TSession extends ExperimentV3RestSession>(options: {
  security: AppRestSecurity;
  ports: ExperimentV3RestPorts<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/experiments" });

  const sessionAuth = handlerManagedAuth({
    reason: "user session validated in-handler via the process's session resolver",
    permissions: ["evaluations:manage"],
    credential: "session",
  });
  // The read endpoints (runs list / status / results) and the run endpoint gate
  // on different grains, so they declare separately: a single shared policy
  // would report the coarser of the two for routes that only read.
  const apiKeyAuthRead = handlerManagedAuth({
    reason: "project API key resolved by the process's credential port and its ceiling enforced",
    permissions: ["evaluations:view"],
    credential: "apiKey",
  });
  const apiKeyAuthRun = handlerManagedAuth({
    reason: "project API key resolved by the process's credential port and its ceiling enforced",
    permissions: ["evaluations:create"],
    credential: "apiKey",
  });
  // The workbench endpoints gate on the experiments grains rather than the
  // evaluations ones: they read and write the experiment's own setup, which is
  // what `experiments:view` and `experiments:update` name.
  const apiKeyAuthExperimentsView = handlerManagedAuth({
    reason: "project API key resolved by the process's credential port and its ceiling enforced",
    permissions: ["experiments:view"],
    credential: "apiKey",
  });
  const apiKeyAuthExperimentsUpdate = handlerManagedAuth({
    reason: "project API key resolved by the process's credential port and its ceiling enforced",
    permissions: ["experiments:update"],
    credential: "apiKey",
  });

  /** The person behind a session door, or the refusal in their place. */
  const requireSession = async (
    c: Context,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<TSession | Response> => {
    const session = await ports.resolveSession(c.req.raw);
    if (!session) {
      return c.json({ error: "You must be logged in to access this endpoint." }, 401);
    }
    if (!(await ports.probeProjectPermission(session, projectId, permission))) {
      return c.json({ error: "You do not have permission to access this endpoint." }, 403);
    }
    return session;
  };

  /** The run loop, or the refusal a process without one owes the caller. */
  const requireRunLoop = (): {
    ports: ExperimentRunPorts;
    progress: ExperimentRunProgressPort;
  } => {
    const runPorts = ports.run.ports;
    const progress = ports.run.progress;
    if (!runPorts || !progress) {
      throw new ExperimentRunLoopUnavailableError("experiment run loop");
    }
    return { ports: runPorts, progress };
  };

  // ── POST /execute ──────────────────────────────────────────────────

  secured.access(sessionAuth).post(
    "/execute",
    // Kept out of the published document. The route authenticates with a
    // browser session and streams workbench UI state, so an API-key caller
    // has no way to reach it; publishing it would document an endpoint that
    // answers 401 to everyone reading the reference. `zValidator` alone would
    // have emitted an operation here — the body schema is enough metadata for
    // the generator — so the exclusion has to be stated, not merely implied
    // by leaving `describeRoute` off.
    describeRoute({ hide: true }),
    zValidator("json", executionRequestSchema),
    async (c) => {
      const request = (await c.req.json()) as z.infer<typeof executionRequestSchema>;
      const { projectId } = request;

      logger.info({ projectId, scope: request.scope }, "Starting experiment execution");

      const session = await requireSession(c, projectId, "evaluations:manage");
      if (session instanceof Response) return session;

      const { ports: runPorts, progress } = requireRunLoop();

      const dataResult = await loadExecutionData(
        projectId,
        request.dataset,
        request.targets,
        request.evaluators,
        ports.run.services,
        {
          data: request.data,
          datasetId: request.dataset_id,
          parameters: request.parameters,
        },
      );

      if ("error" in dataResult) {
        return c.json({ error: dataResult.error }, dataResult.status as 400 | 404);
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
        name: request.name,
        // The wire's column `type` is a plain string and the state's is the
        // narrowed union, which is the same widening the two casts below
        // already carry: the request was `any` on the route this replaces, so
        // none of the three was visible there.
        datasets: [request.dataset as EvaluationsV3State["datasets"][number]],
        activeDatasetId: request.dataset.id ?? "dataset-1",
        targets: request.targets as EvaluationsV3State["targets"],
        evaluators: request.evaluators as EvaluationsV3State["evaluators"],
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

      const mirror = createRunStateMirror({
        projectId,
        experimentId: request.experimentId,
        experimentSlug: request.experimentSlug ?? "",
        progress,
      });

      // The page saves these cells too, and it is the faster of the two. The
      // server writes them so the board does not depend on the tab surviving:
      // a background tab holds its save timer, and a dropped connection loses
      // the cells the page was holding, while the run reads as complete.
      const resultsWriter = runResultsWriterFor({
        persistence: {
          experiments: ports.experiments().experimentService,
          actor: { userId: session.user.id, label: "user" },
        },
        projectId,
        experimentId: request.experimentId,
        scope: request.scope,
        data: request.data,
        datasetId: request.dataset_id,
        parameters: request.parameters,
      });

      return streamSSE(c, async (stream) => {
        try {
          const isFullRun = request.scope.type === "full";

          const orchestrator = runOrchestrator({
            projectId,
            experimentId: request.experimentId,
            scope: request.scope,
            state,
            datasetRows,
            datasetColumns,
            loadedPrompts,
            loadedAgents,
            ports: runPorts,
            workflows: ports.run.workflows,
            loadedEvaluators,
            loadedWorkflows,
            defaultConcurrency: ports.run.defaultConcurrency,
            concurrency: request.concurrency,
            seedTargetOutputs: request.seedTargetOutputs,
            // The board as the page had it, minus what this run produces. The
            // page sends it rather than the server reading the saved state,
            // because the page can be ahead of its own autosave and the run has
            // to hold what the person is looking at.
            carriedOverCells: request.carriedOverCells,
          });

          for await (const event of orchestrator) {
            // The board first, then the run store, then the customer. The cells
            // go in before the run reports it ended, for the same reason the
            // backend runner writes them first: a caller that reads "done" and
            // then reads the workbench finds them there. The writer swallows
            // its own failures, so a write that fails costs the page a refresh
            // and never the run.
            await resultsWriter?.record(event);
            // The `execution_started` frame names the run, and the page hands
            // that id to a poller as soon as it reads it, so a frame released
            // before the store knows the run makes the first poll read 404 on a
            // healthy run. Ordering it this way keeps the store a superset of
            // what the page has seen. The mirror swallows its own failures too.
            await mirror.record(event);
            await stream.writeSSE({ data: JSON.stringify(event) });

            if (event.type === "done" || event.type === "stopped") {
              ports.recordExperimentRan?.({
                userId: session.user.id,
                projectId,
                experimentId: request.experimentId,
                isFullRun,
              });
              break;
            }
          }
        } catch (error) {
          logger.error({ error, projectId }, "Orchestrator error");
          ports.reportError?.(error, { projectId });

          // Through the same mapper the orchestrator uses: a handled error
          // travels as its code plus `domainError` (so the client renders
          // registry copy), and anything else becomes a fixed generic string.
          // Writing `(error as Error).message` here put a Prisma string or a Go
          // net error straight into the customer's cell.
          //
          // No `rowIndex`: the orchestrator itself threw, so the whole run is
          // gone and the mapper says so, rather than blaming one row.
          const failure = mapThrownErrorEvent({ error });
          if (failure.type === "error") {
            // The code, never the thrown message: a poller reads this straight
            // out of the run API. Written before the frame, for the same reason
            // the loop above records first: a poller must never read the run as
            // still going after the page has been told it died.
            await mirror.fail({
              code: failure.message,
              domainError: failure.domainError,
              traceId: failure.traceId,
            });
          }
          await stream.writeSSE({ data: JSON.stringify(failure) });
        }
      });
    },
  );

  // ── POST /abort ────────────────────────────────────────────────────

  secured.access(sessionAuth).post("/abort", async (c) => {
    let body: { projectId?: string; runId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { projectId, runId } = body;
    if (!projectId || !runId) {
      return c.json(
        { error: "Invalid request body", details: "projectId and runId are required" },
        400,
      );
    }

    const session = await requireSession(c, projectId, "evaluations:manage");
    if (session instanceof Response) return session;

    const { ports: runPorts, progress } = requireRunLoop();

    // Ownership check: holding evaluations:manage on `projectId` does NOT grant
    // the right to abort a run that belongs to a different project. The runId is
    // attacker-controlled, so verify the run is owned by the authenticated
    // project before signaling an abort. Without this, a user could abort another
    // tenant's experiment run by guessing its runId.
    //
    // In-flight runs register their owner through the abort port, which is set
    // before the first frame of either path. The progress store is the
    // fallback: it also holds the owner, for as long as the run state lives.
    const ownerProjectId =
      (await runPorts.abort.getRunningProjectId(runId)) ??
      (await progress.tryGetRunState(runId))?.projectId;
    if (!ownerProjectId || ownerProjectId !== projectId) {
      throw new RunNotFoundError(runId);
    }

    logger.info({ projectId, runId }, "Requesting abort");
    await requestAbort({ abort: runPorts.abort, runId });

    return c.json({ success: true, runId, message: "Abort requested" });
  });

  // ── POST /:slug/run  (CI/CD execution) ─────────────────────────────

  secured.access(apiKeyAuthRun).post(
    "/:slug/run",
    describeRoute({
      summary: "Run an experiment",
      description:
        "Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send `Accept: text/event-stream` instead to stream progress events until the run finishes.",
      tags: ["Experiments"],
      // Declared by hand rather than through zValidator: the handler reads the
      // raw body so it can accept an empty one, and parses with
      // `runInputsBodySchema` itself, so there is no validator schema for the
      // generator to read. Every field is optional — sending no body at all runs
      // the experiment's saved dataset as configured.
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                  description:
                    "Rows to evaluate inline, instead of the experiment's saved dataset. Mutually exclusive with dataset_id.",
                },
                dataset_id: {
                  type: "string",
                  description:
                    "A saved dataset to evaluate, instead of the one the experiment is configured with. Mutually exclusive with data.",
                },
                parameters: {
                  type: "object",
                  additionalProperties: {
                    oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
                  },
                  description:
                    "Constant inputs applied to every row, overriding fields of the same name",
                },
                row_indices: {
                  type: "array",
                  items: { type: "integer", minimum: 0 },
                  description: "Run only these rows of the dataset, by zero-based index",
                },
              },
              not: { required: ["data", "dataset_id"] },
            },
          },
        },
      },
      responses: {
        ...experimentErrorResponses,
        400: {
          description:
            "The body was not valid JSON, failed input validation, or the experiment has no dataset configured",
          content: {
            // These three refusals are hand-rolled in the handler and carry a
            // sentence in `error` rather than a stable code, so this documents
            // the shape as sent. Converting them to HandledError is the right
            // end state, but it turns `error` into a code slug and would break
            // any CI script matching the current text — worth its own change.
            "application/json": {
              schema: resolver(z.object({ error: z.string() })),
            },
          },
        },
        200: {
          description: "Run started",
          content: {
            "application/json": { schema: resolver(startRunResponseSchema) },
            "text/event-stream": {
              schema: {
                type: "string",
                description: "Progress events, ending with a done event carrying the summary",
              },
            },
          },
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.param();

      // Starting a run CREATES a run row against an experiment that already
      // exists; it does not administer the evaluations family. Asking for
      // `:manage` here refused every least-privilege key that legitimately holds
      // the create — the Langy session key among them, which stops short of
      // `:manage` precisely because `:manage` implies the delete. `:manage` still
      // satisfies `:create` through the permission hierarchy, so narrowing the
      // grain takes access away from nobody.
      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "evaluations:create",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, resolved, markUsed } = credential;
      const experiments = ports.experiments();

      // Read once here to validate the stored setup before any work starts, and
      // named apart from the `experiment` that `prepareSavedStateExecution`
      // returns below: that one is the authoritative record the run is built
      // from, this one only answers "is this experiment runnable at all".
      const savedExperiment = await experiments.tryGetBySlugAndType({
        projectId: project.id,
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
        // The stored workbench state no longer matches its schema. The customer
        // did not type this and cannot repair it from the API, so it is ours:
        // `fault: "platform"` keeps it out of the customer-error noise.
        throw new InvalidExperimentConfigurationError(slug);
      }

      const workbenchState = parseResult.data;
      const dataset = workbenchState.datasets[0];
      if (!dataset) {
        return c.json({ error: "No dataset configured" }, 400);
      }

      // An empty body is allowed (a full run); malformed JSON must 400 rather than
      // silently default to {} and start a full run on invalid input.
      const bodyText = await c.req.text();
      let rawBody: unknown = {};
      if (bodyText.trim()) {
        try {
          rawBody = JSON.parse(bodyText);
        } catch {
          return c.json({ error: "Invalid JSON body" }, 400);
        }
      }
      const inputsParse = runInputsBodySchema.safeParse(rawBody);
      if (!inputsParse.success) {
        return c.json(
          { error: inputsParse.error.issues[0]?.message ?? "Invalid request body" },
          400,
        );
      }
      const runInputs = inputsParse.data;

      const prepared = await prepareSavedStateExecution({
        experiments: experiments.experimentService,
        services: ports.run.services,
        projectId: project.id,
        slug,
        runInputs: {
          data: runInputs.data,
          datasetId: runInputs.dataset_id,
          parameters: runInputs.parameters,
        },
      });

      if ("error" in prepared) {
        return c.json({ error: prepared.error }, prepared.status as 400 | 404);
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

      // The board the run carries in. Its board is the saved workbench state,
      // which is the only board there is when no tab is open. A full run carries
      // nothing, because it covers every cell itself.
      const carriedOverCells = planSavedRunCarryOver({ prepared, scope });

      const acceptHeader = c.req.header("Accept") ?? "";
      const isSSE = acceptHeader.includes("text/event-stream");

      logger.info(
        { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
        "Starting CI/CD experiment execution",
      );

      markUsed();

      if (isSSE) {
        const { ports: runPorts } = requireRunLoop();
        return streamSSE(c, async (stream) => {
          try {
            const orchestrator = runOrchestrator({
              projectId: project.id,
              experimentId: experiment.id,
              scope,
              state,
              datasetRows,
              datasetColumns,
              loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
              loadedAgents: loadedAgents as Map<string, TypedAgent>,
              ports: runPorts,
              workflows: ports.run.workflows,
              loadedEvaluators,
              loadedWorkflows,
              defaultConcurrency: ports.run.defaultConcurrency,
              ...(carriedOverCells.length > 0 ? { carriedOverCells } : {}),
            });

            for await (const event of orchestrator) {
              await stream.writeSSE({ data: JSON.stringify(event) });

              if (event.type === "done" || event.type === "stopped") {
                break;
              }
            }
          } catch (error) {
            logger.error({ error, projectId: project.id, slug }, "Orchestrator error");
            ports.reportError?.(error, { projectId: project.id, slug });

            // Through the same mapper the orchestrator uses, for the reason the
            // streaming door above states.
            await stream.writeSSE({ data: JSON.stringify(mapThrownErrorEvent({ error })) });
          }
        });
      }

      const { runId, runUrl, total } = await ports.run.startRun({
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
        // A run of the saved dataset fills the cells the workbench shows. The
        // application is the one that tells the tenant the experiment moved,
        // which is what makes an open page pick the cells up.
        ...(runsSavedDataset(runInputs)
          ? {
              persistResults: {
                experiments: experiments.experimentService,
                actor: workbenchActorFrom({ resolved }),
              },
            }
          : {}),
      });

      return c.json({ runId, status: "running", total, runUrl });
    },
  );

  // ── GET /runs?experimentSlug=... (list runs for an experiment) ─────

  secured.access(apiKeyAuthRead).get(
    "/runs",
    describeRoute({
      summary: "List runs of an experiment",
      description:
        "Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.",
      tags: ["Experiments"],
      parameters: [
        {
          in: "query",
          name: "experimentSlug",
          required: true,
          schema: { type: "string" },
          description: "Slug of the experiment whose runs you want",
        },
        {
          in: "query",
          name: "page",
          required: false,
          schema: { type: "integer", default: 1 },
          description: "1-based page number",
        },
        {
          in: "query",
          name: "pageSize",
          required: false,
          schema: { type: "integer", default: 50, maximum: 200 },
          description: "Runs per page, capped at 200",
        },
      ],
      responses: {
        ...experimentErrorResponses,
        400: {
          description: "experimentSlug was not supplied",
          content: {
            "application/json": {
              schema: resolver(z.object({ error: z.string() })),
            },
          },
        },
        200: {
          description: "Runs for the experiment",
          content: {
            "application/json": { schema: resolver(listRunsResponseSchema) },
          },
        },
      },
    }),
    async (c) => {
      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "evaluations:view",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project } = credential;

      const experimentSlug = c.req.query("experimentSlug");
      if (!experimentSlug) {
        return c.json({ error: "experimentSlug query parameter is required" }, 400);
      }

      const pageSizeRaw = c.req.query("pageSize");
      const pageRaw = c.req.query("page");
      const pageSize = (() => {
        const parsed = pageSizeRaw ? parseInt(pageSizeRaw, 10) : 50;
        if (!Number.isFinite(parsed) || parsed <= 0) return 50;
        return Math.min(parsed, 200);
      })();
      const page = (() => {
        const parsed = pageRaw ? parseInt(pageRaw, 10) : 1;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
      })();

      const { experiment, runs, totalHits } = await ports
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

      return c.json({
        experimentId: experiment.id,
        experimentSlug: experiment.slug,
        runs,
        pagination: {
          page,
          pageSize,
          totalHits,
          hasMore: offset + runs.length < totalHits,
        },
      });
    },
  );

  // ── GET /runs/:runId (poll run status) ─────────────────────────────

  secured.access(apiKeyAuthRead).get(
    "/runs/:runId",
    describeRoute({
      summary: "Poll a run",
      description:
        "Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI job can poll this until `status` leaves `running`.",
      tags: ["Experiments"],
      responses: {
        ...experimentErrorResponses,
        200: {
          description: "Run state",
          content: {
            "application/json": { schema: resolver(runStatusResponseSchema) },
          },
        },
      },
    }),
    async (c) => {
      const { runId } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "evaluations:view",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, markUsed } = credential;
      const { progress } = requireRunLoop();

      const runState = await progress.tryGetRunState(runId);

      // All three not-found branches raise the SAME code. From outside they are one
      // answer — this run is not yours to read — and telling a caller which of them
      // it was would confirm that the id exists in another project.
      if (!runState) {
        throw new RunNotFoundError(runId);
      }

      if (runState.projectId !== project.id) {
        throw new RunNotFoundError(runId);
      }

      // Same archive guard as /runs/:runId/results: a run whose owning
      // experiment was archived must not keep serving status from the cache
      // for the rest of its TTL. Without this, archive visibility silently
      // depends on run age.
      if (runState.experimentId) {
        const stillLive = await ports.experiments().isActive({
          projectId: project.id,
          id: runState.experimentId,
        });
        if (!stillLive) {
          throw new RunNotFoundError(runId);
        }
      }

      logger.debug({ runId, status: runState.status }, "Run status queried");
      markUsed();

      if (runState.status === "running" || runState.status === "pending") {
        return c.json({
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
        });
      }

      if (runState.status === "completed") {
        return c.json({
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
          finishedAt: runState.finishedAt,
          summary: runState.summary,
        });
      }

      if (runState.status === "failed") {
        return c.json({
          runId: runState.runId,
          status: runState.status,
          progress: runState.progress,
          total: runState.total,
          startedAt: runState.startedAt,
          finishedAt: runState.finishedAt,
          // The code, never the thrown message — an API consumer gets the same
          // contract the stream gives a browser: something stable to branch on,
          // plus the handled payload when the failure had one, plus the trace id
          // for the failures we could not name (ADR-045).
          error: runState.error,
          ...(runState.domainError ? { domainError: runState.domainError } : {}),
          ...(runState.traceId ? { traceId: runState.traceId } : {}),
        });
      }

      // stopped
      return c.json({
        runId: runState.runId,
        status: runState.status,
        progress: runState.progress,
        total: runState.total,
        startedAt: runState.startedAt,
        finishedAt: runState.finishedAt,
      });
    },
  );

  // ── GET /runs/:runId/results (full per-row results) ────────────────

  secured.access(apiKeyAuthRead).get(
    "/runs/:runId/results",
    describeRoute({
      summary: "Read run results",
      description:
        "Every dataset row of a run with what the target predicted, plus one entry per evaluator per row. Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within its experiment.",
      tags: ["Experiments"],
      parameters: [
        {
          in: "query",
          name: "experimentSlug",
          required: false,
          schema: { type: "string" },
          description: "Owning experiment. Required once the run has aged out of the status cache.",
        },
      ],
      responses: {
        ...experimentErrorResponses,
        200: {
          description: "Rows and evaluations for the run",
          content: {
            "application/json": { schema: resolver(runResultsResponseSchema) },
          },
        },
      },
    }),
    async (c) => {
      const { runId } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "evaluations:view",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, markUsed } = credential;
      const { progress } = requireRunLoop();

      // Resolve the owning experiment. The results store is keyed on
      // (TenantId, ExperimentId, RunId) — runId alone is not unique across
      // experiments (SDK callers can reuse a stable run_id) — so we must know
      // the experimentId before we query results.
      //
      // Two sources, tried in order:
      //   1. the progress store — covers fresh runs.
      //   2. experimentSlug query param → a row lookup — covers older runs
      //      whose run state has expired but whose result rows remain.
      //
      // The previous "most recently updated experiment in the project"
      // fallback was unsafe: it returned cryptic 404s whenever the user had
      // edited any other experiment after the one that owned this run.
      const runState = await progress.tryGetRunState(runId);
      const slugFromState =
        runState && runState.projectId === project.id ? runState.experimentSlug : undefined;
      const experimentIdFromState =
        runState && runState.projectId === project.id ? runState.experimentId : undefined;

      const experimentSlug = c.req.query("experimentSlug") ?? slugFromState;
      let experimentId = experimentIdFromState;
      const experiments = ports.experiments();

      if (!experimentId && experimentSlug) {
        const experiment = await experiments.tryGetIdBySlug({
          projectId: project.id,
          slug: experimentSlug,
        });
        experimentId = experiment?.id;
      } else if (experimentId) {
        // Independent of how we resolved the id, refuse to return results once
        // the owning experiment is archived. Without this check the cached
        // path (fresh runs) would keep serving result rows after archive while
        // the slug-based fallback already returns 404, so archive visibility
        // would silently depend on run age.
        const stillLive = await experiments.isActive({
          projectId: project.id,
          id: experimentId,
        });
        if (!stillLive) experimentId = undefined;
      }

      if (!experimentId) {
        // The remediation that used to be spelled out here — pass ?experimentSlug
        // for a run older than the status cache — is the registry's copy for this
        // code now, so every surface says it the same way.
        throw new RunNotFoundError(runId);
      }

      try {
        const run = await experiments.tryGetRun({
          projectId: project.id,
          experimentId,
          runId,
        });

        if (!run) {
          throw new RunNotFoundError(runId);
        }

        markUsed();
        return c.json(run);
      } catch (error) {
        // Only a genuine miss is a 404. This used to answer EVERY failure with
        // "Run not found or results not yet available", so a storage outage
        // told the caller their run did not exist — a wrong answer served with a
        // status code that invites them to stop asking. Anything we cannot name
        // goes up to the boundary, where it becomes a 500 and a trace id (ADR-045).
        if (HandledError.isHandled(error)) throw error;
        logger.error({ error, runId }, "Failed to fetch run results");
        throw error;
      }
    },
  );

  // ── GET /:slug/workbench-state ─────────────────────────────────────

  secured.access(apiKeyAuthExperimentsView).get(
    "/:slug/workbench-state",
    describeRoute({
      summary: "Read an experiment's setup",
      description:
        "The experiment's datasets, targets and evaluators, with the version to send back when you save. Ask for `fields=version` to check for changes without transferring the setup.",
      tags: ["Experiments"],
      parameters: [
        {
          in: "query",
          name: "fields",
          required: false,
          schema: { type: "string", enum: ["version"] },
          description: "Set to `version` to answer with the version and timestamp only",
        },
      ],
      responses: {
        ...experimentErrorResponses,
        ...workbenchTypeErrorResponse,
        200: {
          description: "The experiment's setup, or its version alone",
          content: {
            "application/json": {
              schema: resolver(
                workbenchStateResponseSchema.or(workbenchVersionProbeResponseSchema),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "experiments:view",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, markUsed } = credential;

      const workbench = await ports.experiments().getWorkbenchState({
        projectId: project.id,
        slug,
      });

      markUsed();

      const identity = {
        id: workbench.experimentId,
        slug: workbench.slug,
        version: workbench.version,
        updatedAt: workbench.updatedAt.toISOString(),
      };

      // The probe exists so a poller can ask "did this change?" without pulling
      // a setup it already holds. It reads the same row; what it saves is the
      // payload, which is the part that grows with the experiment.
      if (c.req.query("fields") === "version") {
        return c.json(identity);
      }

      return c.json({ ...identity, name: workbench.name, state: workbench.state });
    },
  );

  // ── PUT /:slug/workbench-state ─────────────────────────────────────

  secured.access(apiKeyAuthExperimentsUpdate).put(
    "/:slug/workbench-state",
    describeRoute({
      summary: "Save an experiment's setup",
      description:
        "Replace the experiment's setup. Send `expectedVersion` with the version you read and the save is refused with a 409 when someone else wrote first, instead of overwriting their work.",
      tags: ["Experiments"],
      responses: {
        ...experimentErrorResponses,
        ...workbenchWriteErrorResponses,
        200: {
          description: "Setup saved",
          content: {
            "application/json": {
              schema: resolver(saveWorkbenchStateResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", saveWorkbenchStateBodySchema),
    async (c) => {
      const { slug } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "experiments:update",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, resolved, markUsed } = credential;

      const body = c.req.valid("json");

      const saved = await ports.experiments().saveWorkbenchState(
        {
          projectId: project.id,
          slug,
          state: body.state,
          ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
          ...(body.commitMessage ? { commitMessage: body.commitMessage } : {}),
        },
        { kind: "credential", resolved },
      );

      markUsed();
      return c.json({ version: saved.version });
    },
  );

  // ── GET /:slug/versions ────────────────────────────────────────────

  secured.access(apiKeyAuthExperimentsView).get(
    "/:slug/versions",
    describeRoute({
      summary: "List an experiment's versions",
      description:
        "Every saved version of the experiment's setup, newest first. A commit, an agent write and a restore each add a numbered version. Ordinary typing rewrites one autosave row, which is the entry with `autoSaved` true. Page through them with `limit` and `cursor`.",
      tags: ["Experiments"],
      parameters: [
        {
          in: "query",
          name: "limit",
          required: false,
          schema: { type: "integer", default: 50, minimum: 1, maximum: 100 },
          description: "Versions per page, capped at 100",
        },
        {
          in: "query",
          name: "cursor",
          required: false,
          schema: { type: "integer", minimum: 1 },
          description: "The `nextCursor` of the previous page",
        },
      ],
      responses: {
        ...experimentErrorResponses,
        ...workbenchTypeErrorResponse,
        200: {
          description: "Versions of the experiment",
          content: {
            "application/json": {
              schema: resolver(listWorkbenchVersionsResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "experiments:view",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, markUsed } = credential;

      const experiments = ports.experiments();
      // The service lists by id; the REST surface addresses experiments by slug
      // everywhere else, so the read that resolves one to the other also answers
      // the 404 for a slug this project does not have.
      const workbench = await experiments.getWorkbenchState({ projectId: project.id, slug });

      const { versions, nextCursor } = await experiments.listWorkbenchVersions({
        projectId: project.id,
        id: workbench.experimentId,
        ...(() => {
          const limit = parseOptionalPositiveInt(c.req.query("limit"));
          return limit !== undefined ? { limit } : {};
        })(),
        ...(() => {
          const cursor = parseOptionalPositiveInt(c.req.query("cursor"));
          return cursor !== undefined ? { cursor } : {};
        })(),
      });

      markUsed();

      return c.json({
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
      });
    },
  );

  // ── POST /:slug/versions/:version/restore ──────────────────────────

  secured.access(apiKeyAuthExperimentsUpdate).post(
    "/:slug/versions/:version/restore",
    describeRoute({
      summary: "Restore an experiment version",
      description:
        "Bring an old setup back by writing it forward as a new save. History is never rewritten: the version you restored from stays in the list, and the restore is one more entry after it.",
      tags: ["Experiments"],
      parameters: [
        {
          in: "path",
          name: "version",
          required: true,
          schema: { type: "integer", minimum: 1 },
          description:
            "The version to restore, as listed by `GET /api/experiments/{slug}/versions`",
        },
      ],
      responses: {
        ...experimentErrorResponses,
        ...workbenchWriteErrorResponses,
        200: {
          description: "Version restored",
          content: {
            "application/json": {
              schema: resolver(restoreWorkbenchVersionResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const { slug, version } = c.req.param();

      const credential = await ports.authenticateCredential({
        request: c.req.raw,
        permission: "experiments:update",
      });
      if (!credential.ok) {
        return c.json(credential.body, credential.status);
      }
      const { project, resolved, markUsed } = credential;

      const experiments = ports.experiments();
      const workbench = await experiments.getWorkbenchState({ projectId: project.id, slug });

      // A path segment that is not a version number names a version this
      // experiment never had, which is the same answer as a number it never
      // had. One code, so a caller branches once.
      //
      // The reported version is 0, a number no experiment version ever has.
      // `Number("abc")` is `NaN`, which JSON writes as `null`, so a caller that
      // reads `version` as a number could not parse its own 404.
      const parsedVersion = parseOptionalPositiveInt(version);
      if (parsedVersion === undefined) {
        throw new ExperimentVersionNotFoundError({
          experimentId: workbench.experimentId,
          version: 0,
        });
      }

      const restored = await experiments.restoreWorkbenchVersion(
        { projectId: project.id, id: workbench.experimentId, version: parsedVersion },
        { kind: "credential", resolved },
      );

      logger.info(
        { projectId: project.id, slug, version: parsedVersion },
        "Experiment version restored over REST",
      );
      markUsed();

      return c.json({ version: restored.version });
    },
  );

  return secured.hono;
}

/**
 * `/api/evaluations/v3/*` — the family's older name, re-dispatched.
 *
 * Takes the canonical app rather than importing it, for the same reason the
 * OTLP path aliases do: an alias that can be mounted without the family it
 * forwards into is an alias that can 404 on a deployment serving the routes.
 * Registered AFTER the canonical family, and kept while the Python SDK still
 * calls the old paths.
 */
export function createExperimentV3LegacyAliasRestApp(options: {
  canonical: MountableRestApp;
}): MountableRestApp {
  const alias = new Hono().basePath("/api/evaluations/v3");
  alias.all("/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^\/api\/evaluations\/v3/, "/api/experiments");
    return options.canonical.fetch(new Request(url.toString(), c.req.raw));
  });
  return alias;
}
