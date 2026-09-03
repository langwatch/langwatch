/**
 * The workbench run loop, composed for this process.
 *
 * `@langwatch/experiment-server` owns the loop — the orchestrator, the polling
 * runner, the data load and the workflow-evaluate trigger — and states in one
 * injected bag, {@link ExperimentRunPorts}, everything a run reaches outside
 * itself. This file is where that bag is filled from the graph this process
 * already holds, so nothing here is a second answer to a question another
 * composition already answers:
 *
 *   studio               `WorkflowStudioDispatchService`, the protocol half of
 *                        the retired application's `studioBackendPostEvent`,
 *                        over this process's engine address and its gateway.
 *   cost                 the deployment's rate table, read the way the
 *                        trace-ingest collector reads it: the project's own
 *                        cost rules first, the static catalogue behind them.
 *   abort                `RedisExperimentRunAbortAdapter` on the queue's Redis.
 *   experiments          the execution half's OWN `ExperimentService`.
 *   evaluationReporting  the execution half's OWN `reportEvaluation`.
 *   sandboxCredentials   the API-key service plus the project's organization.
 *
 * Beside the bag: `RedisExperimentRunProgressAdapter` on the same Redis, the
 * two Postgres reads a run makes against rows this feature does not own (a
 * workflow target's committed DSL, and what the agents and evaluators a saved
 * workbench points at are called), the `ExecutionDataServices` the execution
 * half already composed, and this deployment's public origin.
 *
 * ## Why an absent Redis takes the whole loop
 *
 * The retired application read `tryGetApp()?.redis` before every progress
 * write and skipped silently when there was none, so a deployment without
 * Redis served `GET /runs/:runId` a 404 for every run it had started. The
 * packaged port is required now, which turns that skip into a composition
 * decision — and this is where it is made. A process with no progress store
 * refuses to START a run, by name, rather than starting one nothing can ever
 * report on. The public base URL is the second such fact: a run answers with a
 * shareable results link, and a link built on no origin is not a link.
 *
 * ## What is still absent, on purpose
 *
 * `ExperimentRunErrorReportingPort` is optional in the package and is left
 * out here: the retired application sent these to its product-analytics
 * capture, nothing downstream reads the report, and a null object would read
 * as wired. The run's own log line is what remains, which is what it was.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { tryMintAgentSandboxApiKey } from "@langwatch/api-key-server";
import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { ExperimentService, TargetConfig } from "@langwatch/experiment-contract";
import {
  createExperimentRunProcessingPipeline,
  ExperimentEvaluationReportingPort,
  ExperimentModelCostPort,
  ExperimentSandboxCredentialPort,
  ExperimentStudioDispatchPort,
  ExperimentTargetEntityNamesPort,
  ExperimentWorkflowDslPort,
  RedisExperimentRunAbortAdapter,
  RedisExperimentRunProgressAdapter,
  WorkflowEvaluationService,
  resolveWorkbenchTargetNames,
  startPollingRun,
  type ExecutionDataServices,
  type ExperimentRunPorts,
  type ExperimentRunProcessingPipelineDeps,
  type ExperimentRunProgressPort,
  type PostgresExperimentAdapterOptions,
  type StartPollingRunInput,
  type WorkflowEvaluationOutcome,
} from "@langwatch/experiment-server";
import { HandledError } from "@langwatch/handled-error";
import {
  matchModelCost,
  type ModelCostRate,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PromptService } from "@langwatch/prompt-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type {
  StudioClientEvent,
  StudioServerEvent,
  WorkflowRunOrigin,
  WorkflowService,
} from "@langwatch/workflow-contract";
import {
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
} from "@langwatch/workflow-server";

/**
 * The four dispatchers a run's HISTORY is written through, or `undefined`
 * where this process composed no command queue.
 *
 * Derived from the adapter's own option rather than restated, so the four
 * signatures cannot drift from the ones the Experiment service validates
 * against.
 */
export type ApiExperimentRunCommands = NonNullable<PostgresExperimentAdapterOptions["execution"]>;

/**
 * Registers `experiment_run_processing` as a PRODUCER and hands back the four
 * dispatchers the Experiment service writes a run's history through.
 *
 * ## Why this is not optional decoration
 *
 * The orchestrator rethrows a failed `startExperimentRun` — a run whose first
 * event never reached the log is a run nothing downstream will ever be able to
 * reconstruct, so it stops rather than continuing into a history with a hole
 * at the front. Without this registration the packaged
 * `UnavailableExperimentExecutionAdapter` refuses that first call, and every
 * polling run on this process dies on its first cell. Composing the loop
 * without composing this would have been a run loop in name only.
 *
 * ## One definition, two registrations
 *
 * The SAME packaged definition the worker drains — nothing here forks it,
 * because the routing triple every job carries is derived from the pipeline
 * and command names, and two descriptions of one event stream drift into jobs
 * the worker cannot route. What a producer does not have is the definition's
 * consumer-side stores, so they are the stand-ins below: they exist so the
 * definition can be CONSTRUCTED and refuse by name if they are ever CALLED.
 * Refusing rather than no-op'ing is the point — a silently-succeeding fold
 * store in a process that folds nothing would report a projection as written
 * when the row simply never appears.
 *
 * This is `createEvaluationProcessingProducerPipeline`'s shape, built at the
 * composition root rather than in the package because
 * `@langwatch/experiment-server` publishes no producer variant of its own yet.
 * The package is the better home for it, and moving it there is recorded work
 * rather than work done badly here.
 */
export function composeApiExperimentRunCommands(options: {
  eventing: EventSourcing | undefined;
  processName: string;
}): ApiExperimentRunCommands | undefined {
  if (!options.eventing) return undefined;

  const processName = options.processName;
  const registered = options.eventing.register(
    createExperimentRunProcessingPipeline({
      experimentRunStateFoldStore: new ProducerOnlyExperimentRunStateStore(processName),
      experimentRunItemAppendStore: new ProducerOnlyExperimentRunItemStore(processName),
    }),
  );
  const commands = registered.commands as Record<string, unknown>;
  const sender = (name: string): CommandSender => {
    const candidate = commands[name];
    if (!isSender(candidate)) {
      throw new Error(
        `The experiment_run_processing registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
      );
    }
    return candidate;
  };

  const startExperimentRun = sender("startExperimentRun");
  const recordTargetResult = sender("recordTargetResult");
  const recordEvaluatorResult = sender("recordEvaluatorResult");
  const completeExperimentRun = sender("completeExperimentRun");

  return {
    startExperimentRun: async (input) => void (await startExperimentRun.send(input)),
    recordTargetResult: async (input) => void (await recordTargetResult.send(input)),
    recordEvaluatorResult: async (input) => void (await recordEvaluatorResult.send(input)),
    completeExperimentRun: async (input) => void (await completeExperimentRun.send(input)),
  };
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/** The two consumer-side stores the packaged definition takes, named once. */
type ExperimentRunStateFoldStore =
  ExperimentRunProcessingPipelineDeps["experimentRunStateFoldStore"];
type ExperimentRunItemAppendStore =
  ExperimentRunProcessingPipelineDeps["experimentRunItemAppendStore"];

/** Why every stand-in below refuses, in this process's own words. */
const producerOnly = (processName: string, capability: string): Error =>
  new Error(
    `${processName} registered the experiment_run_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyExperimentRunStateStore implements ExperimentRunStateFoldStore {
  constructor(private readonly processName: string) {}

  store(): Promise<void> {
    return Promise.reject(
      producerOnly(this.processName, "write the experiment run state projection"),
    );
  }

  get(): Promise<never> {
    return Promise.reject(
      producerOnly(this.processName, "read the experiment run state projection"),
    );
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyExperimentRunItemStore implements ExperimentRunItemAppendStore {
  constructor(private readonly processName: string) {}

  append(): Promise<void> {
    return Promise.reject(
      producerOnly(this.processName, "append to the experiment run item projection"),
    );
  }
}

/**
 * Cells in flight at once when the request names no limit of its own.
 *
 * The retired application bound this to `EVAL_V3_CONCURRENCY` and defaulted to
 * ten. This process reads no such variable yet — adding a leaf would change
 * the shape of `api.config.ts` that a concurrent lane is editing — so the
 * default is stated here and the variable is recorded as still unread. Ten is
 * what every deployment that never set it already runs at.
 */
export const API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY = 10;

/**
 * The connection shape the packaged Redis adapters name.
 *
 * They name ioredis's standalone client because that is what the retired
 * application held. Every command they issue is a single-key GET/SET/DEL,
 * which a cluster answers on the slot the key hashes to, so this process hands
 * over whatever connection it opened rather than refusing a clustered
 * deployment its run loop. The alias is derived from the adapter's own
 * signature so it cannot drift, and this process names no ioredis type of its
 * own.
 */
type ApiExperimentRunRedis = Parameters<
  typeof RedisExperimentRunProgressAdapter.create
>[0]["redis"];

/** Reports the composition decision an absent run loop would otherwise hide. */
export abstract class ApiExperimentRunAbsenceReport {
  /** No Redis: a started run would have nowhere a poll could read it from. */
  abstract withoutProgressStore(): void;
  /** No public origin: a run cannot answer with the link it is meant to. */
  abstract withoutPublicBaseUrl(): void;
}

/** Everything the run loop is composed from. */
export type ApiExperimentRunOptions = Readonly<{
  /** The one guarded connection the two row reads below run on. */
  prisma: PrismaClient;
  /** Names this process in a refusal. */
  processName: string;
  /** The gateway the dispatch's sampling-parameter strip and the price table read. */
  modelProviders: ModelProviderService;
  /** Where the NLP engine answers; absent means every cell refuses at the dispatch. */
  nlpServiceUrl: string | undefined;
  /** This deployment's public origin, for the shareable results link. */
  publicBaseUrl: string | undefined;
  /** The queue's Redis, which the abort flag and the progress store both live in. */
  redis: RedisConnection | null | undefined;
  /** The execution half's own Experiment service, which owns the run's commands. */
  experiments: ExperimentService;
  /** The execution half's own studio graph service. */
  workflows: WorkflowService;
  /** The execution half's own `reportEvaluation`, as the pipeline producer built it. */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
  /** The four contract services a run loads its rows through, already composed. */
  datasets: DatasetService;
  prompts: PromptService;
  agents: AgentService;
  evaluators: EvaluatorService;
  /** The credential a run lends the code it executes. Absent means it lends none. */
  apiKeys: ApiKeyService | undefined;
  report?: ApiExperimentRunAbsenceReport;
}>;

/**
 * One polling run, as a transport asks for it.
 *
 * The packaged input minus the five members this composition fills, so a
 * transport states the RUN and nothing about the process it runs on.
 */
export type ApiExperimentRunStartInput = Omit<
  StartPollingRunInput,
  "ports" | "workflows" | "progress" | "baseUrl" | "defaultConcurrency"
> &
  Readonly<{
    /**
     * The ceiling for a run that names no `concurrency` of its own. Optional,
     * and this process's default stands in — a caller that wants a different
     * ceiling for ONE run sets `concurrency` instead.
     */
    defaultConcurrency?: number;
  }>;

/** One workflow evaluated as an experiment, as a transport asks for it. */
export type ApiWorkflowEvaluationInput = Readonly<{
  projectId: string;
  projectSlug: string;
  workflowId: string;
  versionId?: string;
  data?: Array<Record<string, unknown>>;
  datasetId?: string;
  parameters?: Record<string, string | number | boolean>;
  rowIndices?: number[];
}>;

/** The run loop this process composed, or the named refusal in its place. */
export type ApiExperimentRun = Readonly<{
  /**
   * Everything a run reaches outside itself, or `null` where this process
   * composed no run loop. A transport that drives the orchestrator directly —
   * the workbench's own streaming run — takes this and refuses on `null`.
   */
  ports: ExperimentRunPorts | null;
  /** Where a poll reads a run's progress, or `null` for the same reason. */
  progress: ExperimentRunProgressPort | null;
  /** The four contract services a run's rows, prompts, agents and evaluators load through. */
  services: ExecutionDataServices;
  /** The studio graph service the orchestrator runs a workflow cell with. */
  workflows: WorkflowService;
  /** This deployment's public origin, or `undefined` where it configured none. */
  baseUrl: string | undefined;
  /** Cells in flight at once when a request names no limit of its own. */
  defaultConcurrency: number;
  /** Starts one polling run. Refuses by name where the loop is absent. */
  startRun(
    input: ApiExperimentRunStartInput,
  ): Promise<{ runId: string; runUrl: string; total: number }>;
  /** Runs one committed studio workflow as an experiment. Same refusal. */
  evaluateWorkflow(input: ApiWorkflowEvaluationInput): Promise<WorkflowEvaluationOutcome>;
  /**
   * What each column of a saved workbench is called.
   *
   * Composed here rather than at the read, because it resolves through the
   * SAME prompt service and the SAME agent and evaluator rows the run itself
   * reads — a second graph would let a column's name in the reader disagree
   * with the name in the run's own error.
   */
  resolveTargetNames(input: {
    projectId: string;
    targets: TargetConfig[];
  }): Promise<Record<string, string>>;
}>;

/** Composes the run loop over this process's own graph. */
export function composeApiExperimentRun(options: ApiExperimentRunOptions): ApiExperimentRun {
  const workflowSource = PostgresExperimentWorkflowDslAdapter.create({
    prisma: options.prisma,
  });
  const targetEntityNames = PostgresExperimentTargetEntityNamesAdapter.create({
    prisma: options.prisma,
  });
  const services: ExecutionDataServices = {
    datasets: options.datasets,
    prompts: options.prompts,
    agents: options.agents,
    evaluators: options.evaluators,
    workflows: workflowSource,
  };

  const resolveTargetNames = (input: {
    projectId: string;
    targets: TargetConfig[];
  }): Promise<Record<string, string>> =>
    resolveWorkbenchTargetNames({
      projectId: input.projectId,
      targets: input.targets,
      prompts: options.prompts,
      entities: targetEntityNames,
    });

  const redis = options.redis;
  const baseUrl = options.publicBaseUrl;
  if (!redis) options.report?.withoutProgressStore();
  if (!baseUrl) options.report?.withoutPublicBaseUrl();

  if (!redis || !baseUrl) {
    const refuse = () =>
      Promise.reject(
        new ApiExperimentRunUnavailableError({
          processName: options.processName,
          capability: redis
            ? "public address, so a run could not answer with the link to its own results"
            : "progress store, so a run it started could never be polled for",
        }),
      );
    return {
      ports: null,
      progress: null,
      services,
      workflows: options.workflows,
      baseUrl,
      defaultConcurrency: API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY,
      startRun: refuse,
      evaluateWorkflow: refuse,
      resolveTargetNames,
    };
  }

  const connection = redis as ApiExperimentRunRedis;
  const progress = RedisExperimentRunProgressAdapter.create({ redis: connection });
  const ports: ExperimentRunPorts = {
    studio: ApiExperimentStudioDispatchAdapter.create({
      modelProviders: options.modelProviders,
      nlpServiceUrl: options.nlpServiceUrl,
    }),
    cost: ApiExperimentModelCostAdapter.create({
      modelProviders: options.modelProviders,
    }),
    abort: RedisExperimentRunAbortAdapter.create({ redis: connection }),
    experiments: options.experiments,
    evaluationReporting: ApiExperimentEvaluationReportingAdapter.create({
      reportEvaluation: options.reportEvaluation,
    }),
    sandboxCredentials: ApiExperimentSandboxCredentialAdapter.create({
      prisma: options.prisma,
      apiKeys: options.apiKeys,
    }),
  };

  const workflowEvaluation = WorkflowEvaluationService.create({
    experiments: options.experiments,
    workflowSource,
    ports,
    workflows: options.workflows,
    services,
    progress,
    baseUrl,
    defaultConcurrency: API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY,
  });

  return {
    ports,
    progress,
    services,
    workflows: options.workflows,
    baseUrl,
    defaultConcurrency: API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY,
    startRun: (input) =>
      startPollingRun({
        ...input,
        ports,
        workflows: options.workflows,
        progress,
        baseUrl,
        defaultConcurrency: input.defaultConcurrency ?? API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY,
      }),
    evaluateWorkflow: (input) => workflowEvaluation.triggerEvaluationForRest(input),
    resolveTargetNames,
  };
}

/**
 * How this process dispatches one workbench cell to the studio engine.
 *
 * The dispatch service is built here rather than taken from
 * `api-studio-host.composition.ts`, which builds its own for the `httpProxy.*`
 * surface. It is not a second answer to anything: the service holds no
 * connection — each `postEvent` opens its own stream — and the parameter strip
 * it applies reads the SAME model gateway this process composed once. Taking
 * the studio host's would invert the composition order, since the trace group
 * that builds it composes after the execution half that builds this.
 *
 * With no engine address the packaged unconfigured stream refuses by name, and
 * the run reports that to the caller AS a studio event, which is what turns a
 * missing engine into a red cell rather than a hung run.
 */
class ApiExperimentStudioDispatchAdapter extends ExperimentStudioDispatchPort {
  static create(options: {
    modelProviders: ModelProviderService;
    nlpServiceUrl: string | undefined;
  }): ApiExperimentStudioDispatchAdapter {
    return new ApiExperimentStudioDispatchAdapter(
      WorkflowStudioDispatchService.create({
        stream: options.nlpServiceUrl
          ? HttpWorkflowStudioStreamAdapter.create({ serviceUrl: options.nlpServiceUrl })
          : UnconfiguredWorkflowStudioStreamAdapter.create(),
        modelProviders: options.modelProviders,
      }),
    );
  }

  private constructor(private readonly dispatch: WorkflowStudioDispatchService) {
    super();
  }

  postEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
    isAborted?: () => Promise<boolean>;
    origin?: WorkflowRunOrigin;
  }): Promise<void> {
    return this.dispatch.postEvent(input);
  }
}

/**
 * What a cell's tokens cost, in this deployment's own rate table.
 *
 * The same cascade the trace-ingest collector runs, so a cell's cost matches
 * its trace's cost: the project's own cost rules are matched by regex against
 * the model name first and travel as the per-token override attributes the
 * catalogue reads, and the static catalogue answers behind them. Reading only
 * the static rates would price an operator's overridden model at the list rate
 * with nothing to show that it happened.
 *
 * `estimateCost` answers zero for "no known rate", and the port's contract is
 * `undefined` — the run leaves an unpriced cell blank rather than claiming it
 * was free.
 */
class ApiExperimentModelCostAdapter extends ExperimentModelCostPort {
  static create(options: { modelProviders: ModelProviderService }): ApiExperimentModelCostAdapter {
    return new ApiExperimentModelCostAdapter(options.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  async tryPriceTokens(input: {
    projectId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<number | undefined> {
    const priced = this.modelProviders.estimateCost({
      attrs: await this.overrideAttributes(input),
      model: input.model,
      promptTokens: input.inputTokens,
      completionTokens: input.outputTokens,
    });
    return priced > 0 ? priced : undefined;
  }

  /**
   * The project's own rate for this model, as the catalogue reads an override.
   *
   * Empty where the project wrote no rule that matches, which is the common
   * case and the one the static catalogue answers. A failed read is empty too:
   * pricing a cell at the list rate is a better answer than failing the run
   * over its cost column.
   *
   * One read per priced cell, which is what the retired application did as
   * well — `getMatchingLLMModelCost` listed the project's rules on every call.
   * Memoising it for the life of a run would be an improvement rather than a
   * restoration, and it belongs with the catalogue rather than here.
   */
  private async overrideAttributes(input: {
    projectId: string;
    model: string;
  }): Promise<Record<string, unknown>> {
    try {
      const stored = await this.modelProviders.listCosts({ projectId: input.projectId });
      if (stored.length === 0) return {};
      // A stored rule leaves a rate it does not set NULL; the catalogue's rate
      // shape leaves it absent. Same fact, two spellings — and a null read as
      // a rate would price the model at zero.
      const rates: ModelCostRate[] = stored.map((cost) => ({
        model: cost.model,
        regex: cost.regex,
        inputCostPerToken: cost.inputCostPerToken ?? undefined,
        outputCostPerToken: cost.outputCostPerToken ?? undefined,
        cacheReadCostPerToken: cost.cacheReadCostPerToken ?? undefined,
        cacheCreationCostPerToken: cost.cacheCreationCostPerToken ?? undefined,
        cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken ?? undefined,
      }));
      const matched = matchModelCost(input.model, rates);
      if (!matched) return {};
      return {
        "langwatch.model.inputCostPerToken": matched.inputCostPerToken ?? 0,
        "langwatch.model.outputCostPerToken": matched.outputCostPerToken ?? 0,
        ...(matched.cacheReadCostPerToken == null
          ? {}
          : { "langwatch.model.cacheReadCostPerToken": matched.cacheReadCostPerToken }),
        ...(matched.cacheCreationCostPerToken == null
          ? {}
          : {
              "langwatch.model.cacheCreationCostPerToken": matched.cacheCreationCostPerToken,
            }),
        ...(matched.cacheCreation1hCostPerToken == null
          ? {}
          : {
              "langwatch.model.cacheCreation1hCostPerToken": matched.cacheCreation1hCostPerToken,
            }),
      };
    } catch {
      return {};
    }
  }
}

/**
 * Where a workbench cell's evaluator result is reported as an evaluation.
 *
 * The execution half already registered the `evaluation_processing` pipeline
 * as a producer and holds its one sender; this only puts that sender behind
 * the port, so a run reports through the same registration a re-score does. A
 * process with no command queue rejects here for the reason that composition
 * states, not this one.
 */
class ApiExperimentEvaluationReportingAdapter extends ExperimentEvaluationReportingPort {
  static create(options: {
    reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
  }): ApiExperimentEvaluationReportingAdapter {
    return new ApiExperimentEvaluationReportingAdapter(options.reportEvaluation);
  }

  private constructor(
    private readonly report: (data: ReportEvaluationCommandData) => Promise<unknown>,
  ) {
    super();
  }

  reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown> {
    return this.report(data);
  }
}

/**
 * The scoped key a run lends the code it executes.
 *
 * One question, two reads: the project's organization, and the mint. A run has
 * no signed-in member to authorize the mint, which is why it is the packaged
 * `tryMintAgentSandboxApiKey` — it mints an owner-less key holding the agent
 * cache grains and nothing else, and reports a failure as `undefined` rather
 * than stopping a run that can still do every row's work itself.
 *
 * `undefined` also covers a project with no organization and a deployment that
 * composed no API-key service. Both already read that way to the caller, which
 * omits the credential.
 */
class ApiExperimentSandboxCredentialAdapter extends ExperimentSandboxCredentialPort {
  static create(options: {
    prisma: PrismaClient;
    apiKeys: ApiKeyService | undefined;
  }): ApiExperimentSandboxCredentialAdapter {
    return new ApiExperimentSandboxCredentialAdapter(options.prisma, options.apiKeys);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly apiKeys: ApiKeyService | undefined,
  ) {
    super();
  }

  async tryMintRunKey(input: { projectId: string }): Promise<string | undefined> {
    const apiKeys = this.apiKeys;
    if (!apiKeys) return undefined;

    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) return undefined;

    return await tryMintAgentSandboxApiKey({
      apiKeys,
      projectId: input.projectId,
      organizationId,
    });
  }
}

/**
 * The committed studio workflow a workflow target runs, once per dataset row.
 *
 * Four narrow reads rather than one "load the workflow" call, because the run
 * tells a workflow that does not exist apart from one with nothing committed
 * to evaluate and says so differently. They are Prisma reads here rather than
 * calls on the workflow SERVICE because two of them are the archived-excluding
 * and latest-commit-else-latest-autosave selections the evaluate trigger makes,
 * which the service does not express.
 */
class PostgresExperimentWorkflowDslAdapter extends ExperimentWorkflowDslPort {
  static create(options: { prisma: PrismaClient }): PostgresExperimentWorkflowDslAdapter {
    return new PostgresExperimentWorkflowDslAdapter(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async tryFindWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string; publishedId: string | null } | null> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId },
      select: { id: true, name: true, publishedId: true },
    });
    return workflow ?? null;
  }

  async tryFindVersionDsl(input: {
    projectId: string;
    workflowId: string;
    versionId: string;
  }): Promise<unknown | null> {
    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        id: input.versionId,
        projectId: input.projectId,
        workflowId: input.workflowId,
      },
      select: { dsl: true },
    });
    return version?.dsl ?? null;
  }

  async tryFindEvaluableWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string } | null> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      select: { id: true, name: true },
    });
    return workflow ?? null;
  }

  async tryFindEvaluableVersion(input: {
    projectId: string;
    workflowId: string;
    versionId?: string;
  }): Promise<{ id: string; version: string; dsl: unknown } | null> {
    const select = { id: true, version: true, dsl: true } as const;
    if (input.versionId) {
      const named = await this.prisma.workflowVersion.findFirst({
        where: {
          id: input.versionId,
          workflowId: input.workflowId,
          projectId: input.projectId,
        },
        select,
      });
      return named ?? null;
    }
    // The latest manual commit wins; the latest autosave is the fallback, so a
    // workflow that was only ever autosaved is still evaluable.
    const committed = await this.prisma.workflowVersion.findFirst({
      where: {
        workflowId: input.workflowId,
        projectId: input.projectId,
        autoSaved: false,
      },
      orderBy: { createdAt: "desc" },
      select,
    });
    if (committed) return committed;
    const latest = await this.prisma.workflowVersion.findFirst({
      where: { workflowId: input.workflowId, projectId: input.projectId },
      orderBy: { createdAt: "desc" },
      select,
    });
    return latest ?? null;
  }
}

/**
 * What the agents and evaluators a saved workbench points at are called.
 *
 * Two batched reads. An id with no row is simply absent from the answer, so a
 * deleted entity falls back to the column id the rest of the projection is
 * keyed by rather than showing a blank column header.
 */
class PostgresExperimentTargetEntityNamesAdapter extends ExperimentTargetEntityNamesPort {
  static create(options: { prisma: PrismaClient }): PostgresExperimentTargetEntityNamesAdapter {
    return new PostgresExperimentTargetEntityNamesAdapter(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findAgentNames(input: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>> {
    const rows = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, id: { in: input.ids } },
      select: { id: true, name: true },
    });
    return namesOf(rows);
  }

  async findEvaluatorNames(input: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>> {
    const rows = await this.prisma.evaluator.findMany({
      where: { projectId: input.projectId, id: { in: input.ids } },
      select: { id: true, name: true },
    });
    return namesOf(rows);
  }
}

const namesOf = (rows: ReadonlyArray<{ id: string; name: string }>): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.id, row.name]));

/**
 * A run this deployment cannot start, refused by name.
 *
 * A handled error rather than a bare throw: the boundary serialises its code,
 * which is what a client keys its own copy off, and both reasons are DEPLOYMENT
 * gaps an operator can act on rather than a customer mistake.
 */
export class ApiExperimentRunUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { processName: string; capability: string }) {
    super("service_unavailable", `This deployment has no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { process: input.processName, capability: input.capability },
    });
    this.name = "ApiExperimentRunUnavailableError";
  }
}
