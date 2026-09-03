/**
 * The evaluator RUNTIME, composed from this process's own graph.
 *
 * Three doors on `apps/api` need one thing: an evaluator, run. The gateway's
 * inline guardrail check scores an input/output pair the Go data plane sent;
 * the four legacy evaluate doors score whatever an SDK posted; and
 * `evaluations.runEvaluation` re-scores a stored trace through its mappings.
 * Until this composition all three refused by name — `runEvaluator`,
 * `runEvaluation` and `runEvaluationForTrace` were the same absence written
 * down three times.
 *
 * They are ONE runtime here rather than three bindings because they are one
 * question. A guardrail that resolved a model provider differently from a
 * monitor would bill a customer's key against a provider they did not choose
 * on one path and not the other; a legacy evaluate door that dispatched a code
 * evaluator down its own road would put its spans on a second trace. The
 * engine, its Langevals transport, its model environment and its workflow
 * executor are built once and shared.
 *
 * ## What it is composed from, and where each piece comes from
 *
 *     traceService      the observability half's read stack (the three legacy
 *                       trace reads, including the thread read the
 *                       thread-mapping resolver walks)
 *     spanDigest        `@langwatch/trace-server`'s own renderer — the digest
 *                       an evaluator reads and the digest a judge is shown are
 *                       the same text
 *     modelEnvResolver  this module's bridge over the process's ONE model
 *                       gateway (`api-model-provider.composition.ts`)
 *     langevalsClient   the packaged HTTP transport over `LANGEVALS_ENDPOINT`
 *     evaluators        the execution half's evaluator service — the same one
 *                       the studio publishes evaluators through
 *     workflowExecutor  the packaged workflow adapter over the execution
 *                       half's own `WorkflowService`
 *
 * ## The named absences
 *
 * **No `LANGEVALS_ENDPOINT` and no runtime is composed at all.** The
 * deployment configured no evaluator service, so an installed evaluator has
 * nowhere to run; composing the runtime anyway would answer every guardrail
 * `skipped` — which reads as "checked and fine" — and would answer the
 * evaluate doors 200 with a verdict nothing produced. Native, code and
 * workflow evaluators do not need the endpoint, and leaving the whole runtime
 * off refuses those too; that is the deliberate side of the trade, because the
 * three doors are addressed by evaluator id and a door that serves a third of
 * the catalogue is a door that fails unpredictably.
 *
 * **No execution telemetry.** `evaluation_duration_milliseconds` and
 * `evaluation_status_counter` are not reported from this process: the port
 * takes a registry and this composition is handed none. A missing series
 * rather than a wrong one, which is what the port itself documents.
 */
import {
  AZURE_SAFETY_PROVIDER_KEY,
  isAzureEvaluatorType,
  EvaluatorConfigError,
} from "@langwatch/evaluation-contract";
import {
  EvaluationAzureSafetyCredentialsPort,
  EvaluationExecutionService,
  EvaluationModelEnvPort,
  EvaluationSpanDigestPort,
  EvaluationTraceReadPort,
  EvaluationWorkflowExecutorPort,
  HttpLangevalsEvaluatorAdapter,
  type EvaluationRunOutcome,
} from "@langwatch/evaluation-server";
import { WorkflowEvaluationAdapter } from "@langwatch/evaluation-server/workflow-evaluation";
import type {
  AVAILABLE_EVALUATORS,
  EvaluatorService,
  EvaluatorTypes,
  SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { clampMaxTokens, type ModelProviderService } from "@langwatch/model-provider-contract";
import {
  getProjectModelProviders,
  prepareEnvKeys,
  prepareLitellmParams,
  resolveMaxTokensCeiling,
} from "@langwatch/model-provider-server";
import type { Logger } from "@langwatch/observability";
import { formatSpansDigest } from "@langwatch/trace-server";
import { mappingStateSchema, type Span } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

/**
 * The data an evaluator is handed, as this process's doors build it.
 *
 * Stated structurally rather than imported from the legacy REST family, so the
 * gateway's guardrail check — which knows nothing about that family — satisfies
 * the same runner with the pair it already has.
 */
export type ApiEvaluatorRunData =
  | Readonly<{ type: "default"; data: Record<string, unknown> }>
  | Readonly<{ type: "custom"; data: Record<string, unknown> }>;

/** The runtime the three doors bind to. */
export type ApiEvaluatorExecution = Readonly<{
  /**
   * One evaluator over data the caller already holds.
   *
   * `settings` is optional so this one function satisfies BOTH consumers: the
   * gateway's `EvaluatorRunner`, which may omit it, and the legacy family's
   * `runEvaluation`, which always sends one.
   */
  runEvaluation(input: {
    projectId: string;
    evaluatorType: EvaluatorTypes;
    data: ApiEvaluatorRunData;
    settings?: Record<string, unknown>;
  }): Promise<SingleEvaluationResult>;
  /**
   * One evaluator over a stored trace, rendered through its mappings.
   *
   * The mappings arrive as an opaque value because a tRPC input is JSON and
   * the registry that narrows them is a browser package; they are parsed here,
   * at the boundary a malformed row actually crosses.
   */
  runEvaluationForTrace(input: {
    projectId: string;
    traceId: string;
    evaluatorType: EvaluatorTypes;
    settings: Record<string, unknown>;
    mappings: unknown;
  }): Promise<EvaluationRunOutcome>;
}>;

/** Reports what this process could not compose, at boot rather than at a call. */
export abstract class ApiEvaluatorExecutionAbsenceReportPort {
  /** No `LANGEVALS_ENDPOINT`: no evaluator runs on this process at all. */
  abstract withoutEvaluatorService(): void;

  /**
   * No telemetry adapter: the two evaluator process series are not reported.
   *
   * NOT a missing registry — `EvaluationExecutionTelemetryPort` takes none, only
   * a `record({ evaluatorType, status, durationMs })`. What does not exist is
   * any implementation of it, in this process or any other. The sibling that
   * writes its series the same way is `OtelPiiAnalysisMetricsAdapter`.
   */
  abstract withoutExecutionTelemetry(): void;
}

export type ApiEvaluatorExecutionOptions = Readonly<{
  /**
   * The three legacy trace reads an online evaluation makes, resolved at call
   * time.
   *
   * A thunk because the observability half composes AFTER the execution half
   * that publishes the evaluator service, and this runtime needs both. It is
   * the SAME stack the trace explorer reads: an evaluator scores the content a
   * reviewer sees, not a second projection of it.
   */
  traceReads: () => EvaluationTraceReadPort | undefined;
  /** The evaluator directory the studio publishes evaluators through. */
  evaluators: EvaluatorService;
  /** The studio a custom (workflow) evaluator runs on. */
  workflows: WorkflowService;
  /** The ONE model gateway on this process. */
  modelProviders: ModelProviderService;
  /** Where the evaluator service answers; absent composes no runtime. */
  langevalsEndpoint: string | undefined;
  /** The process environment an evaluator's own `envVars` are read from. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Names this process in the log line an absence is reported under. */
  processName: string;
  report?: ApiEvaluatorExecutionAbsenceReportPort;
}>;

/**
 * How long one evaluator call may take, and how many 5xx it survives.
 *
 * The retry count is the platform's own (`retries = 1`). The timeout is NEW:
 * the platform's evaluate call carried none and relied on the socket, and the
 * packaged transport requires a number. Five minutes is past any LLM judge and
 * well short of a request that has silently died, which is the failure the
 * absent timeout used to hold a connection open for.
 */
const LANGEVALS_MAX_RETRIES = 1;
const LANGEVALS_TIMEOUT_MS = 5 * 60 * 1000;

/** Composes the evaluator runtime, or names why this process has none. */
export function composeApiEvaluatorExecution(
  options: ApiEvaluatorExecutionOptions,
): ApiEvaluatorExecution | undefined {
  const endpoint = options.langevalsEndpoint?.trim();
  if (!endpoint) {
    options.report?.withoutEvaluatorService();
    return undefined;
  }

  options.report?.withoutExecutionTelemetry();

  const environment = options.environment ?? process.env;
  const engine = EvaluationExecutionService.create({
    traceService: ApiEvaluationTraceReads.create(options.traceReads, options.processName),
    spanDigest: ApiEvaluationSpanDigest.create(),
    modelEnvResolver: ApiEvaluationModelEnv.create({
      modelProviders: options.modelProviders,
      azureSafetyCredentials: ApiEvaluationAzureSafetyCredentials.create(options.modelProviders),
      environment,
    }),
    langevalsClient: HttpLangevalsEvaluatorAdapter.create({
      config: {
        endpoint,
        maxRetries: LANGEVALS_MAX_RETRIES,
        timeoutMs: LANGEVALS_TIMEOUT_MS,
      },
    }),
    // Declared by the engine and read by nothing in it: the workflow branch
    // dispatches through `workflowExecutor` below, which is what actually
    // holds this service. Handed the real one anyway rather than a stand-in,
    // so a future read cannot pick up a fake.
    workflows: options.workflows,
    evaluators: options.evaluators,
    workflowExecutor: ApiEvaluationWorkflowExecutor.create(options.workflows),
    installEnvironment: environment,
  });

  return {
    runEvaluation: (input) =>
      engine.executeForData({
        projectId: input.projectId,
        evaluatorType: input.evaluatorType,
        data: input.data,
        ...(input.settings ? { settings: input.settings } : {}),
      }),
    runEvaluationForTrace: async (input) => {
      const result = await engine.executeForTrace({
        projectId: input.projectId,
        traceId: input.traceId,
        evaluatorType: input.evaluatorType,
        settings: input.settings,
        mappings: input.mappings === null ? null : mappingStateSchema.parse(input.mappings),
      });

      return asRunOutcome(result);
    },
  };
}

/**
 * The engine's flattened result, back in the evaluator's own union.
 *
 * The engine reports a run as `{status, score, error, errorDetails, …}`,
 * because that is what an event carries; the tRPC surface answers the
 * evaluator's `SingleEvaluationResult`, because that is what the studio's
 * result card reads. `error_type` is stated rather than recovered — the
 * flattening dropped it, and inventing a specific one would name a failure
 * class this call cannot know.
 */
function asRunOutcome(
  result: Awaited<ReturnType<EvaluationExecutionService["executeForTrace"]>>,
): EvaluationRunOutcome {
  const common = {
    ...(result.evaluationThreadId ? { evaluation_thread_id: result.evaluationThreadId } : {}),
    ...(result.inputs ? { inputs: result.inputs } : {}),
  };

  if (result.status === "error") {
    return {
      status: "error",
      error_type: "EVALUATOR_ERROR",
      details: result.error ?? "Evaluator failed",
      traceback: result.errorDetails ? [result.errorDetails] : [],
      ...common,
    };
  }

  if (result.status === "skipped") {
    return {
      status: "skipped",
      ...(result.details === undefined ? {} : { details: result.details }),
      ...(result.cost ? { cost: result.cost } : {}),
      ...common,
    };
  }

  return {
    status: "processed",
    ...(result.score === undefined ? {} : { score: result.score }),
    ...(result.passed === undefined ? {} : { passed: result.passed }),
    ...(result.label === undefined ? {} : { label: result.label }),
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(result.cost ? { cost: result.cost } : {}),
    ...common,
  };
}

/**
 * The three legacy trace reads, resolved through the process's own stack when
 * a read is actually made.
 *
 * A refusal rather than an empty answer where the stack is absent: an
 * evaluation scored against no trace is a verdict on nothing, and the customer
 * would read it as a real one.
 */
class ApiEvaluationTraceReads extends EvaluationTraceReadPort {
  static create(
    resolve: () => EvaluationTraceReadPort | undefined,
    processName: string,
  ): ApiEvaluationTraceReads {
    return new ApiEvaluationTraceReads(resolve, processName);
  }

  private constructor(
    private readonly resolve: () => EvaluationTraceReadPort | undefined,
    private readonly processName: string,
  ) {
    super();
  }

  getTracesWithSpans(
    ...args: Parameters<EvaluationTraceReadPort["getTracesWithSpans"]>
  ): ReturnType<EvaluationTraceReadPort["getTracesWithSpans"]> {
    return this.require().getTracesWithSpans(...args);
  }

  getEvaluationsMultiple(
    ...args: Parameters<EvaluationTraceReadPort["getEvaluationsMultiple"]>
  ): ReturnType<EvaluationTraceReadPort["getEvaluationsMultiple"]> {
    return this.require().getEvaluationsMultiple(...args);
  }

  getTracesWithSpansByThreadIds(
    ...args: Parameters<EvaluationTraceReadPort["getTracesWithSpansByThreadIds"]>
  ): ReturnType<EvaluationTraceReadPort["getTracesWithSpansByThreadIds"]> {
    return this.require().getTracesWithSpansByThreadIds(...args);
  }

  private require(): EvaluationTraceReadPort {
    const reads = this.resolve();
    if (!reads) {
      throw new Error(
        `${this.processName} composed no trace read stack, so an evaluation cannot read the trace it was asked to score.`,
      );
    }
    return reads;
  }
}

/**
 * The readable digest an evaluator reads for `formatted_trace` and
 * `formatted_traces`.
 *
 * The trace package's own formatter, because the digest an evaluator is shown
 * and the digest a scenario judge is shown have to be the same text.
 */
class ApiEvaluationSpanDigest extends EvaluationSpanDigestPort {
  static create(): ApiEvaluationSpanDigest {
    return new ApiEvaluationSpanDigest();
  }

  format(spans: Span[]): Promise<string> {
    return formatSpansDigest(spans);
  }
}

/** A custom (workflow) evaluator, run on the studio this process composed. */
class ApiEvaluationWorkflowExecutor extends EvaluationWorkflowExecutorPort {
  static create(workflows: WorkflowService): ApiEvaluationWorkflowExecutor {
    return new ApiEvaluationWorkflowExecutor(WorkflowEvaluationAdapter.create(workflows));
  }

  private constructor(private readonly adapter: WorkflowEvaluationAdapter) {
    super();
  }

  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: string }> {
    return this.adapter.run({
      workflowId,
      projectId,
      inputs,
      ...(versionId === undefined ? {} : { versionId }),
      ...(causalityDepth === undefined ? {} : { causalityDepth }),
      ...(parentTrace === undefined ? {} : { parentTrace }),
    });
  }
}

/**
 * The Azure Content Safety credentials, read off the project's own
 * `azure_safety` provider row.
 *
 * A port implementation rather than an inline read so the execution half's
 * `tryResolveAzureSafetyEnv` and the evaluator runtime cannot disagree about
 * whether a project has credentials: this is the ONE place that answers it,
 * and both bind to this instance's rule.
 */
export class ApiEvaluationAzureSafetyCredentials extends EvaluationAzureSafetyCredentialsPort {
  static create(modelProviders: ModelProviderService): ApiEvaluationAzureSafetyCredentials {
    return new ApiEvaluationAzureSafetyCredentials(modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  async tryGetForTenant(input: { tenantId: string }): Promise<Record<string, string> | null> {
    const providers = await getProjectModelProviders(this.modelProviders, input.tenantId);
    const provider = providers[AZURE_SAFETY_PROVIDER_KEY];
    if (!provider?.enabled) return null;

    const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;
    if (typeof endpoint !== "string" || endpoint.trim() === "") return null;
    if (typeof key !== "string" || key.trim() === "") return null;

    return {
      AZURE_CONTENT_SAFETY_ENDPOINT: endpoint,
      AZURE_CONTENT_SAFETY_KEY: key,
    };
  }
}

/**
 * The environment an evaluator executes with, resolved from the project's own
 * model providers.
 *
 * The bridge between two features' server packages — Evaluation asks the
 * question, Model Provider answers it — which is why it lives in a composition
 * root rather than in either package. The Azure branch never reads the process
 * environment: those evaluators require a per-project `azure_safety` row, and
 * the port above is what answers for them.
 */
class ApiEvaluationModelEnv extends EvaluationModelEnvPort {
  static create(deps: {
    modelProviders: ModelProviderService;
    azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
    environment: Readonly<Record<string, string | undefined>>;
  }): ApiEvaluationModelEnv {
    return new ApiEvaluationModelEnv(deps);
  }

  private constructor(
    private readonly deps: {
      modelProviders: ModelProviderService;
      azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
      environment: Readonly<Record<string, string | undefined>>;
    },
  ) {
    super();
  }

  async resolveForEvaluator({
    evaluatorType,
    evaluator,
    projectId,
    settings,
  }: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>> {
    let evaluatorEnv: Record<string, string>;
    if (isAzureEvaluatorType(evaluatorType)) {
      evaluatorEnv =
        (await this.deps.azureSafetyCredentials.tryGetForTenant({ tenantId: projectId })) ?? {};
    } else {
      evaluatorEnv = Object.fromEntries(
        (evaluator.envVars ?? []).map((envVar) => [envVar, this.deps.environment[envVar]!]),
      );
    }

    // `openai/moderation` carries a `model` setting ("text-moderation-*") that
    // names no configured provider, so it must skip model-env resolution.
    if (
      settings &&
      "model" in settings &&
      typeof settings.model === "string" &&
      evaluatorType !== "openai/moderation"
    ) {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await this.setupModelEnv({
          model: settings.model,
          embeddings: false,
          projectId,
          settings,
        })),
      };
    }

    // Evaluators that embed — ragas faithfulness and context precision,
    // semantic similarity — need a separate `X_LITELLM_EMBEDDINGS_*` block.
    if (
      settings &&
      "embeddings_model" in settings &&
      typeof settings.embeddings_model === "string"
    ) {
      evaluatorEnv = {
        ...evaluatorEnv,
        ...(await this.setupModelEnv({
          model: settings.embeddings_model,
          embeddings: true,
          projectId,
          settings,
        })),
      };
    }

    return evaluatorEnv;
  }

  /**
   * The `X_LITELLM_*` block for one model, validated against the project's own
   * provider rows.
   *
   * `EvaluatorConfigError` for a provider that is missing, switched off or
   * does not serve the model: the caller turns each of those into a `skipped`
   * with the sentence a customer can act on, which is why they are a domain
   * error rather than a failed run.
   */
  private async setupModelEnv(input: {
    model: string;
    embeddings: boolean;
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>> {
    const { model, embeddings, projectId, settings } = input;
    const modelProviders = await getProjectModelProviders(this.deps.modelProviders, projectId);
    const provider = model.split("/")[0]!;
    const modelProvider = modelProviders[provider];

    if (!modelProvider) {
      throw new EvaluatorConfigError(`Provider ${provider} is not configured`);
    }
    if (!modelProvider.enabled) {
      throw new EvaluatorConfigError(`Provider ${provider} is not enabled`);
    }

    const modelName = model.split("/").slice(1).join("/");
    const modelList = embeddings ? modelProvider.embeddingsModels : modelProvider.models;
    const customModelList = embeddings
      ? modelProvider.customEmbeddingsModels
      : modelProvider.customModels;
    const isCustomModel = customModelList?.some((entry) => entry.modelId === modelName);

    if (modelList && modelList.length > 0 && !modelList.includes(modelName) && !isCustomModel) {
      // The collapse winner for a provider key is not necessarily the row that
      // serves this model: with multi-instance providers the model may come
      // from a wider-scope row's custom catalog, and `prepareLitellmParams`
      // swaps to that row. Only reject when no accessible enabled row serves
      // the model at all, and treat a failed lookup as no rescue rather than
      // masking the config error behind an infrastructure one.
      let servingRow = null;
      try {
        servingRow = await this.deps.modelProviders.tryFindRowServingModel({
          projectId,
          provider,
          model: modelName,
        });
      } catch {
        servingRow = null;
      }
      if (!servingRow) {
        throw new EvaluatorConfigError(
          `Model ${modelName} is not in the ${
            embeddings ? "embedding models" : "models"
          } list for ${provider}, please select another model for running this evaluation`,
        );
      }
    }

    const litellmParams = await prepareLitellmParams(this.deps.modelProviders, null, {
      model,
      modelProvider,
      projectId,
    });

    let envResult = Object.fromEntries(
      Object.entries(litellmParams).map(([key, value]) => [
        embeddings ? `X_LITELLM_EMBEDDINGS_${key}` : `X_LITELLM_${key}`,
        value,
      ]),
    );

    const maxTokensCeiling = resolveMaxTokensCeiling(model, modelProvider);
    for (const param of GENERATION_PARAMS) {
      let value = settings?.[param];
      if (value === undefined || value === null) continue;
      if (param === "max_tokens" && typeof value === "number") {
        value = clampMaxTokens(value, maxTokensCeiling);
      }
      envResult[embeddings ? `X_LITELLM_EMBEDDINGS_${param}` : `X_LITELLM_${param}`] =
        String(value);
    }

    if (embeddings) {
      envResult = { ...envResult, ...prepareEnvKeys(modelProvider) };
    }

    return envResult;
  }
}

/** The generation parameters an evaluator's settings may override. */
const GENERATION_PARAMS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "reasoning_effort",
] as const;

/** Writes each absence down once, under this process's own logger name. */
export class LoggedApiEvaluatorExecutionAbsence extends ApiEvaluatorExecutionAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedApiEvaluatorExecutionAbsence {
    return new LoggedApiEvaluatorExecutionAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  withoutEvaluatorService(): void {
    this.logger.info(
      "API composed no evaluator runtime: LANGEVALS_ENDPOINT names no evaluator service, so the gateway's guardrail check, the four legacy evaluate doors and a trace re-score each refuse by name rather than answering a verdict nothing produced.",
    );
  }

  withoutExecutionTelemetry(): void {
    this.logger.info(
      "API composed the evaluator runtime without an execution-telemetry adapter: nothing in the tree implements EvaluationExecutionTelemetryPort, so evaluation_duration_milliseconds and evaluation_status_counter are reported by no process.",
    );
  }
}
