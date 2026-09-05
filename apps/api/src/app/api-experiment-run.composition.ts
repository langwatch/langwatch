/**
 * The workbench run loop, composed for this process.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { AgentSandboxKeyMintService } from "@langwatch/api-key-server";
import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { ExperimentService, TargetConfig } from "@langwatch/experiment-contract";
import {
  ExperimentEventingAdapter,
  ExperimentConnectedAgentOwnershipPort,
  ExperimentConnectedDispatchPort,
  type ExperimentConnectedAgentSubject,
  ExperimentEvaluationReportingPort,
  ExperimentModelCostPort,
  ExperimentSandboxCredentialPort,
  ExperimentStudioDispatchPort,
  ExperimentTargetEntityNamesPort,
  ExperimentWorkflowDslPort,
  RedisExperimentRunAbortAdapter,
  RedisExperimentRunProgressAdapter,
  WorkflowEvaluationService,
  ExperimentWorkbenchTargetNamesService,
  ExperimentPollingRunService,
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
import { ConnectedAgentRuntimeAdapter } from "@langwatch/agent-server";
import { ConnectedTargetService } from "@langwatch/suite-server";
import type { CallOutcome, DispatchAgent, DispatchCall } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";

/**
 * The four dispatchers a run's HISTORY is written through, or `undefined` where this
 * process composed no command queue.
 */
export type ApiExperimentRunCommands = NonNullable<PostgresExperimentAdapterOptions["execution"]>;

/**
 * Registers `experiment_run_processing` as a PRODUCER and hands back the four dispatchers
 * the Experiment service writes a run's history through.
 */
export function composeApiExperimentRunCommands(options: {
  eventing: EventSourcing | undefined;
  processName: string;
}): ApiExperimentRunCommands | undefined {
  if (!options.eventing) return undefined;

  const processName = options.processName;
  const registered = options.eventing.register(
    ExperimentEventingAdapter.pipeline({
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
 * Cells in flight at once when the request names no limit of its own. The retired
 * application bound this to `EVAL_V3_CONCURRENCY` and defaulted to ten.
 */
export const API_EXPERIMENT_RUN_DEFAULT_CONCURRENCY = 10;

/**
 * The connection shape the packaged Redis adapters name. They name ioredis's standalone
 * client because that is what the retired application held.
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
 * One polling run, as a transport asks for it. The packaged input minus the five members
 * this composition fills, so a transport states the RUN and nothing about the process it
 * runs on.
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
    ExperimentWorkbenchTargetNamesService.create().resolve({
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
    connectedDispatch: ApiExperimentConnectedDispatchAdapter.create(),
    connectedAgentOwnership: ApiExperimentConnectedAgentOwnershipAdapter.create(),
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
      ExperimentPollingRunService.startPollingRun({
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
 * The connected-agent dispatcher a run's turns go through (ADR-128). Composed here
 * because neither feature server package may import the other: the runtime lives in
 * `@langwatch/agent-server` and the run loop in `@langwatch/experiment-server`.
 */
class ApiExperimentConnectedDispatchAdapter extends ExperimentConnectedDispatchPort {
  static create(): ApiExperimentConnectedDispatchAdapter {
    return new ApiExperimentConnectedDispatchAdapter();
  }

  dispatch(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal: AbortSignal;
  }): Promise<CallOutcome> {
    return ConnectedAgentRuntimeAdapter.get().dispatcher.dispatch(input);
  }
}

/** Joins the experiment run's ownership port to suite's rule, for the same reason. */
class ApiExperimentConnectedAgentOwnershipAdapter extends ExperimentConnectedAgentOwnershipPort {
  static create(): ApiExperimentConnectedAgentOwnershipAdapter {
    return new ApiExperimentConnectedAgentOwnershipAdapter();
  }

  assertRunnable(input: {
    agents: readonly ExperimentConnectedAgentSubject[];
    actor: RunActor | undefined;
  }): Promise<void> {
    return ConnectedTargetService.assertConnectedAgentsRunnable({
      agents: input.agents,
      actor: input.actor,
    });
  }
}

/**
 * How this process dispatches one workbench cell to the studio engine. The dispatch
 * service is built here rather than taken from `api-studio-host.composition.ts`, which
 * builds its own for the `httpProxy.*` surface.
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
   * The project's own rate for this model, as the catalogue reads an override. Empty
   * where the project wrote no rule that matches, which is the common case and the one
   * the static catalogue answers.
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
 * The scoped key a run lends the code it executes. One question, two reads: the project's
 * organization, and the mint.
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

    return await AgentSandboxKeyMintService.tryMint({
      apiKeys,
      projectId: input.projectId,
      organizationId,
    });
  }
}

/**
 * The committed studio workflow a workflow target runs, once per dataset row.
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
 * What the agents and evaluators a saved workbench points at are called. Two batched
 * reads.
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
