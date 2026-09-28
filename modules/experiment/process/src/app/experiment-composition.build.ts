import { EventEmitter } from "node:events";

/**
 * Builds what `apps/api/src/features/experiment/experiment.composition.ts`
 * (deleted by b383462d96) used to hand-compose. See the handoff for the run
 * loop's own scope: `ports`/`progress` stay `null` on purpose.
 */
import type { ClickHouseSettings } from "@clickhouse/client";
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { ExperimentRunLoopUnavailableError } from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import { getStaticModelCostRates, type ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { experimentRunEventStreamChannels } from "../channels/experiment-run-event-stream-channels.registry.ts";
import type { ExperimentRunEventStream } from "../channels/experiment-run-event-stream.channel.ts";
import {
  HttpExperimentAttachmentLinkChannel,
  type ExperimentAttachmentEgressPolicy,
} from "../channels/http/http.experiment-attachment-link.channel.ts";
import { createExperimentRunBoardWriteBackSubscriber } from "../eventing/experiment-run-board-write-back.subscriber.ts";
import { ExecuteExperimentCellCommand } from "../eventing/experiment-run-cell.commands.ts";
import {
  completeRun,
  executeCell,
  failLostCell,
} from "../eventing/experiment-run-execution.intent.ts";
import { createExperimentRunFramesSubscriber } from "../eventing/experiment-run-frames.subscriber.ts";
import { ExperimentRunPlanStore } from "../eventing/experiment-run-plan.store.ts";
import {
  buildExperimentRunProcessingPipeline,
  type ExperimentRunProcessingPipeline,
} from "../eventing/experiment-run-processing.pipeline.ts";
import { ExperimentRunProgressStore } from "../eventing/experiment-run-progress.store.ts";
import { ExperimentRunStateStore } from "../eventing/experiment-run-state.store.ts";
import type { WorkflowEvaluationRunner } from "../eventing/experiment-workflow-evaluation.subscriber.ts";
import { ClickHouseExperimentDspyRepository } from "../repositories/clickhouse/clickhouse.experiment-dspy.repository.ts";
import { ClickHouseExperimentRunProcessingRepository } from "../repositories/clickhouse/clickhouse.experiment-run-processing.repository.ts";
import { ClickHouseExperimentRunRepository } from "../repositories/clickhouse/clickhouse.experiment-run.repository.ts";
import { ExperimentDspyRetentionRepository } from "../repositories/experiment-dspy-retention.repository.ts";
import type { ExperimentIdLookupRepository } from "../repositories/experiment-id-lookup.repository.ts";
import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunAbortRepository } from "../repositories/memory/memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../repositories/memory/memory.experiment-run-fold.repository.ts";
import { PrismaExperimentPeopleRepository } from "../repositories/prisma/prisma.experiment-people.repository.ts";
import { PrismaExperimentWorkflowVersionRepository } from "../repositories/prisma/prisma.experiment-workflow-version.repository.ts";
import { PrismaExperimentRepository } from "../repositories/prisma/prisma.experiment.repository.ts";
import { RedisExperimentRunAbortRepository } from "../repositories/redis/redis.experiment-run-abort.repository.ts";
import { RedisExperimentRunFoldRepository } from "../repositories/redis/redis.experiment-run-fold.repository.ts";
import { RedisExperimentRunProcessingRepository } from "../repositories/redis/redis.experiment-run-processing.repository.ts";
import { RedisExperimentRunProgressRepository } from "../repositories/redis/redis.experiment-run-progress.repository.ts";
import { modelCostRatesOf } from "../rules/experiment-model-cost.rules.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { ExperimentAttachmentInputService } from "../services/experiment-attachment-input.service.ts";
import type { ExecutionDataServices } from "../services/experiment-execution-data.service.ts";
import { ExperimentPollingRunService } from "../services/experiment-polling-run.service.ts";
import { ExperimentRunBoardWriteBackService } from "../services/experiment-run-board-write-back.service.ts";
import { ExperimentRunCellService } from "../services/experiment-run-cell.service.ts";
import type { ExperimentRunCommandDispatcherService } from "../services/experiment-run-command-dispatcher.service.ts";
import { ExperimentRunModelCostService } from "../services/experiment-run-model-cost.service.ts";
import { ExperimentRunSandboxCredentialService } from "../services/experiment-run-sandbox-credential.service.ts";
import { ExperimentTargetEntityNamesService } from "../services/experiment-target-entity-names.service.ts";
import { ExperimentWorkbenchTargetNamesService } from "../services/experiment-workbench-target-names.service.ts";
import { WorkflowEvaluationService } from "../services/experiment-workflow-evaluation.service.ts";
import { ExperimentWorkflowSourceService } from "../services/experiment-workflow-source.service.ts";
import { ExperimentService } from "../services/experiment.service.ts";
import type {
  ExperimentV3RunLoop,
  ExperimentWorkbenchObserver,
} from "./experiment-workbench.members.ts";
import type {
  ExperimentAppDependencies,
  ExperimentBroadcast,
  ExperimentMonitorCascade,
  ExperimentModelCosts,
  ExperimentPermissions,
  ExperimentWorkflowAuthoring,
} from "./experiment.app.ts";

/**
 * The retention floor a DSPy run read is bounded by. Fixed, exactly as the
 * deleted composition's own `FixedExperimentDspyRetention` fixed it, rather
 * than reading a per-project policy nothing here owns.
 */
const DSPY_DEFAULT_RETENTION_DAYS = 49;

/** A draft name and an archived-slug disambiguator; never a row's own id. */
const EXPERIMENT_DISAMBIGUATOR_KSUID_RESOURCE = "expdisambig";

/**
 * The slug an experiment is saved under. Copied verbatim from the deleted
 * composition so a slug computed today matches one computed before it.
 */
function slugifyExperimentName(value: string): string {
  return value
    .replaceAll(/[:?&_]/g, "-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The wizard's workflow writes, over the SAME workflow application the Studio
 * saves through: a new workflow carries the prepared first graph as version one.
 */
function workflowAuthoring(workflows: WorkflowApi): ExperimentWorkflowAuthoring {
  return {
    create: async ({ projectId, dsl, commitMessage, autoSaved }, by) => {
      const prepared = await workflows.prepareStudioDsl({ projectId, dsl });
      const created = await workflows.create(
        { projectId, dsl: prepared, commitMessage, autoSaved },
        by,
      );
      return { id: created.workflow.id };
    },
    saveVersion: async (input, by) => {
      await workflows.saveStudioVersion(input, by);
    },
    copyWithDatasets: (input) => workflows.copyStudioWorkflow(input),
  };
}

/**
 * Adapts the process's ONE routing `clickhouse` member to the per-tenant
 * `.query()`/`.insert()` session Experiment's repositories were written against.
 */
class ClickHouseMemberSession {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<{ json<T>(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
    });
    return { json: <T>() => Promise.resolve(rows as T[]) };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values as Readonly<Record<string, unknown>>[],
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });
    return undefined;
  }
}

/**
 * A fixed retention floor, over no per-project policy.
 */
class FixedExperimentDspyRetention extends ExperimentDspyRetentionRepository {
  static create(days: number): FixedExperimentDspyRetention {
    return new FixedExperimentDspyRetention(days);
  }

  private constructor(private readonly days: number) {
    super();
  }

  findTraceRetentionDays(_tenantId: string): Promise<number> {
    return Promise.resolve(this.days);
  }
}

/**
 * Run-history telemetry, reported through this process's own logger. The
 * trace wrapper is a pass-through: this process's tracer wraps the request,
 * and a second span per run-history read would only restate it.
 */
class LoggedExperimentRunHistoryTelemetry {
  static create(logger: Pick<Logger, "warn" | "error">): LoggedExperimentRunHistoryTelemetry {
    return new LoggedExperimentRunHistoryTelemetry(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn" | "error">) {}

  trace<T>(
    _input: { name: string; attributes: Record<string, string | number> },
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  warnOldRuns(input: {
    projectId: string;
    oldestRunAgeDays: number;
    runCount: number;
    occurredAtBufferHours: number;
  }): void {
    this.logger.warn(input, "experiment run history reached far back in time");
  }

  error(
    input: { projectId: string; experimentId?: string; runId?: string; error: unknown },
    message: string,
  ): void {
    this.logger.error(input, message);
  }

  warn(input: { projectId: string; error: unknown }, message: string): void {
    this.logger.warn(input, message);
  }
}

/** A deployment with no live-update channel composed of its own emitters. */
function inProcessBroadcast(): ExperimentBroadcast {
  const emitters = new Map<string, EventEmitter>();
  return {
    getTenantEmitter: (projectId: string) => {
      const existing = emitters.get(projectId);
      if (existing) return existing;
      const emitter = new EventEmitter();
      emitters.set(projectId, emitter);
      return emitter;
    },
    cleanupTenantEmitter: (projectId: string) => {
      emitters.delete(projectId);
    },
  };
}

/** The allowance check this process answers through its ONE authorization service. */
function authzPermissions(authz: AuthzApi): ExperimentPermissions {
  return {
    mayManageEvaluations: ({ actorId, projectId }) =>
      authz.hasPermission({ userId: actorId, permission: "evaluations:manage", projectId }),
  };
}

/** The project's custom cost rules ahead of the static catalogue, as main's getLLMModelCosts. */
function modelCostCatalogue(modelProviders: ModelProviderApi): ExperimentModelCosts {
  return {
    listFor: async ({ projectId }) => [
      ...modelCostRatesOf(await modelProviders.listCosts({ projectId })),
      ...getStaticModelCostRates(),
    ],
  };
}

/**
 * The monitor cascade an experiment drives, over the SAME monitor
 * application `monitors.*` answers from.
 */
function monitorCascade(monitors: MonitorApi): ExperimentMonitorCascade {
  return {
    deleteForExperiment: (input) => monitors.deleteForExperiment(input),
    upsertForExperiment: (input) =>
      monitors.upsertForExperiment({
        projectId: input.projectId,
        experimentId: input.experimentId,
        ...input.monitor,
      }),
  };
}

/** What this process hands `ExperimentApp` at boot. */
function memberSessionResolver(clickhouse: ClickHouseQueryClient) {
  return (tenantId: string) => Promise.resolve(new ClickHouseMemberSession(clickhouse, tenantId));
}

/** The peers a run's execution data is loaded through. */
function executionDataServices(dependencies: {
  workflows: WorkflowApi;
  dataset: DatasetApi;
  agents: AgentApi;
  evaluators: EvaluatorApi;
  prompts: PromptApi;
  projects: ProjectApi;
  entitlement: EntitlementApi;
}): ExecutionDataServices {
  return {
    datasets: dependencies.dataset,
    prompts: dependencies.prompts,
    agents: dependencies.agents,
    evaluators: dependencies.evaluators,
    workflows: ExperimentWorkflowSourceService.create(dependencies.workflows),
    entitlements: dependencies.entitlement,
    projects: dependencies.projects,
  };
}

/** A row's attachments, read behind the deployment's egress fence. */
function attachmentInputs(input: {
  storedObjects: StoredObjectApi;
  policy: ExperimentAttachmentEgressPolicy;
}): ExperimentAttachmentInputService {
  return ExperimentAttachmentInputService.create({
    storedObjects: input.storedObjects,
    links: HttpExperimentAttachmentLinkChannel.create({ policy: input.policy }),
  });
}

/** What the worker runs a run's cells with, and what reacts to its progress fold. */
export type ExperimentRunCells = Readonly<{
  folds: ExperimentRunFoldRepository;
  cells: ExperimentRunCellService;
  stream: ExperimentRunEventStream;
  boardWriteBack: ExperimentRunBoardWriteBackService;
}>;

/**
 * The run's folds and cells over this process's Redis, so every replica reads one plan and one
 * abort flag; in memory where the deployment has none, as its runs are refused at start anyway.
 */
export function buildExperimentRunCells(input: {
  redis: ProcessMembers["redis"] | undefined;
  experiments: ExperimentService;
  attachmentEgress: ExperimentAttachmentEgressPolicy;
  dependencies: {
    workflows: WorkflowApi;
    dataset: DatasetApi;
    agents: AgentApi;
    evaluators: EvaluatorApi;
    prompts: PromptApi;
    projects: ProjectApi;
    entitlement: EntitlementApi;
    modelProviders: ModelProviderApi;
    evaluation: EvaluationApi;
    apiKeys: ApiKeyApi;
    suite: SuiteApi;
    storedObjects: StoredObjectApi;
  };
}): ExperimentRunCells {
  const { redis, dependencies } = input;
  const folds = redis
    ? RedisExperimentRunFoldRepository.create({ redis })
    : MemoryExperimentRunFoldRepository.create();
  const collaborators: ExperimentRunCollaborators = {
    studio: dependencies.workflows,
    cost: ExperimentRunModelCostService.create({ modelProviders: dependencies.modelProviders }),
    abort: redis
      ? RedisExperimentRunAbortRepository.create({ redis })
      : MemoryExperimentRunAbortRepository.create(),
    experiments: input.experiments,
    evaluationReporting: dependencies.evaluation,
    sandboxCredentials: ExperimentRunSandboxCredentialService.create({
      projects: dependencies.projects,
      apiKeys: dependencies.apiKeys,
    }),
    connectedDispatch: dependencies.agents,
    connectedAgentOwnership: dependencies.suite,
    attachments: attachmentInputs({
      storedObjects: dependencies.storedObjects,
      policy: input.attachmentEgress,
    }),
  };

  return {
    folds,
    stream: redis
      ? experimentRunEventStreamChannels.live.create({ redis })
      : experimentRunEventStreamChannels.memory.create(),
    boardWriteBack: ExperimentRunBoardWriteBackService.create({
      folds,
      experiments: input.experiments,
    }),
    cells: ExperimentRunCellService.create({
      folds,
      collaborators,
      services: executionDataServices(dependencies),
      workflows: dependencies.workflows,
    }),
  };
}

/**
 * `experiment_run_processing`, ported from the deleted `ExperimentWorkerFeatureInstaller`: the run
 * fold caches through Redis where there is one, else reads ClickHouse uncached; the plan and
 * progress folds, the cell command and the execution manager ride with it (ARCHITECTURE §9).
 */
export function buildExperimentRunProcessing(input: {
  clickhouse: ClickHouseQueryClient;
  redis: ProcessMembers["redis"] | undefined;
  defaultRetentionDays: () => number;
  workflowEvaluations: WorkflowEvaluationRunner;
  runCells: ExperimentRunCells;
  /** The pipeline's own senders, which the manager's intents send through once connected. */
  commands: ExperimentRunCommandDispatcherService;
}): ExperimentRunProcessingPipeline {
  const { redis, defaultRetentionDays, workflowEvaluations, runCells, commands } = input;
  const resolveClient = memberSessionResolver(input.clickhouse);
  const execution = {
    workflowEvaluations,
    experimentRunPlanFoldStore: ExperimentRunPlanStore.create({ repository: runCells.folds }),
    experimentRunProgressFoldStore: ExperimentRunProgressStore.create({
      repository: runCells.folds,
    }),
    executeCell: ExecuteExperimentCellCommand.create({ cells: runCells.cells }),
    runExecution: {
      executeCell: executeCell(commands),
      failCell: failLostCell(commands),
      complete: completeRun(commands),
    },
    runFrames: createExperimentRunFramesSubscriber({ stream: runCells.stream }),
    runBoardWriteBack: createExperimentRunBoardWriteBackSubscriber({
      boardWriteBack: runCells.boardWriteBack,
    }),
  };
  if (redis) {
    const cached = RedisExperimentRunProcessingRepository.create({
      resolveClient,
      defaultRetentionDays,
      redis,
    });
    return buildExperimentRunProcessingPipeline({
      ...execution,
      experimentRunStateFoldStore: cached.stateFoldStore(),
      experimentRunItemAppendStore: cached.itemStore(),
    });
  }

  const eventing = ClickHouseExperimentRunProcessingRepository.create({
    resolveClient,
    clickhouseEnabled: true,
  });
  return buildExperimentRunProcessingPipeline({
    ...execution,
    experimentRunStateFoldStore: ExperimentRunStateStore.create({
      repository: eventing.stateRepository({ defaultRetentionDays }),
    }),
    experimentRunItemAppendStore: eventing.itemStore({ defaultRetentionDays }),
  });
}

/** Which experiment a run was recorded against, over the same routing ClickHouse member. */
export function buildExperimentIdLookup(
  clickhouse: ClickHouseQueryClient,
): ExperimentIdLookupRepository {
  return ClickHouseExperimentRunProcessingRepository.create({
    resolveClient: memberSessionResolver(clickhouse),
    clickhouseEnabled: true,
  }).idLookup();
}

/**
 * The workbench run loop over this module's own Redis state and its peers' operations, ported
 * from the retired `api-experiment-run.composition.ts`. Without Redis or a public address it
 * refuses to start a run by name, as that composition did; a poll still reads Redis if present.
 */
export function buildExperimentRunLoop(input: {
  redis: ProcessMembers["redis"] | undefined;
  publicBaseUrl: string | undefined;
  /** Names this process in a refusal. */
  processName: string;
  /** Cells in flight at once when a run names no limit of its own (`EVAL_V3_CONCURRENCY`). */
  runConcurrency: number;
  logger: Pick<Logger, "warn">;
  experiments: ExperimentService;
  services: ExecutionDataServices;
  attachments: ExperimentAttachmentInputService;
  connectedAgentOwnership: Pick<SuiteApi, "assertConnectedAgentsRunnable">;
  dependencies: {
    workflows: WorkflowApi;
    modelProviders: ModelProviderApi;
    evaluation: EvaluationApi;
    projects: ProjectApi;
    apiKeys: ApiKeyApi;
    agents: AgentApi;
  };
}): ExperimentV3RunLoop {
  const { redis, publicBaseUrl, dependencies } = input;
  const shared = {
    services: input.services,
    workflows: dependencies.workflows,
    defaultConcurrency: input.runConcurrency,
  };
  if (!redis || !publicBaseUrl) {
    const capability = redis
      ? "public address, so a run could not answer with the link to its own results"
      : "progress store, so a run it started could never be polled for";
    input.logger.warn({ capability }, "experiment runs are refused in this process");
    return {
      ...shared,
      ports: null,
      progress: redis ? RedisExperimentRunProgressRepository.create({ redis }) : null,
      startRun: () =>
        Promise.reject(
          new ExperimentRunLoopUnavailableError({ capability, process: input.processName }),
        ),
    };
  }

  const progress = RedisExperimentRunProgressRepository.create({ redis });
  const ports: ExperimentRunCollaborators = {
    studio: dependencies.workflows,
    cost: ExperimentRunModelCostService.create({ modelProviders: dependencies.modelProviders }),
    abort: RedisExperimentRunAbortRepository.create({ redis }),
    experiments: input.experiments,
    evaluationReporting: dependencies.evaluation,
    sandboxCredentials: ExperimentRunSandboxCredentialService.create({
      projects: dependencies.projects,
      apiKeys: dependencies.apiKeys,
    }),
    connectedDispatch: dependencies.agents,
    connectedAgentOwnership: input.connectedAgentOwnership,
    attachments: input.attachments,
  };

  return {
    ...shared,
    ports,
    progress,
    startRun: (run) =>
      ExperimentPollingRunService.create().startPollingRun({
        ...run,
        ports,
        workflows: dependencies.workflows,
        progress,
        baseUrl: publicBaseUrl,
        defaultConcurrency: run.defaultConcurrency ?? input.runConcurrency,
      }),
  };
}

export function buildExperimentInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  clickhouse: ClickHouseQueryClient;
  /** Where a run's progress is written and polled; shared across replicas. */
  redis: ProcessMembers["redis"] | undefined;
  logger: Logger;
  /** Where a run's writes and requests are sent: the run pipeline's own senders. */
  execution: ExperimentRunCommandDispatcherService;
  /** This deployment's public origin, for the link a run answers with. */
  publicBaseUrl: string | undefined;
  processName: string;
  /** Cells in flight at once when a run names no limit of its own (`EVAL_V3_CONCURRENCY`). */
  runConcurrency: number;
  /** The fence a run reads a row's attachment link behind. */
  attachmentEgress: ExperimentAttachmentEgressPolicy;
  dependencies: {
    workflows: WorkflowApi;
    dataset: DatasetApi;
    monitors: MonitorApi;
    agents: AgentApi;
    evaluators: EvaluatorApi;
    prompts: PromptApi;
    permissions: AuthzApi;
    /** The directory that answers which organization a project belongs to. */
    projects: ProjectApi;
    /** The tier-effective row bound an execution's dataset must fit under. */
    entitlement: EntitlementApi;
    /** The project's custom model cost rules. */
    modelProviders: ModelProviderApi;
    evaluation: EvaluationApi;
    apiKeys: ApiKeyApi;
    suite: SuiteApi;
    storedObjects: StoredObjectApi;
  };
}): Omit<ExperimentAppDependencies, "runLookup"> {
  const { prisma, clickhouse, redis, logger, execution, publicBaseUrl, dependencies } = input;
  const resolveClient = memberSessionResolver(clickhouse);
  const runHistoryTelemetry = LoggedExperimentRunHistoryTelemetry.create(logger);

  const experiments = ExperimentService.create({
    repository: PrismaExperimentRepository.create(prisma),
    runRepository: ClickHouseExperimentRunRepository.create({
      workflowVersions: PrismaExperimentWorkflowVersionRepository.create(prisma),
      resolveClient,
      tupleParam: (values) => ClickHouseExperimentRunRepository.tupleParam(values),
      telemetry: runHistoryTelemetry,
    }),
    dspyRepository: ClickHouseExperimentDspyRepository.create({
      resolveClient,
      retention: FixedExperimentDspyRetention.create(DSPY_DEFAULT_RETENTION_DAYS),
      telemetry: runHistoryTelemetry,
    }),
    execution,
    slugify: slugifyExperimentName,
    newId: () => generate(EXPERIMENT_DISAMBIGUATOR_KSUID_RESOURCE).toString(),
    references: {
      prompts: dependencies.prompts,
      agents: dependencies.agents,
      evaluators: dependencies.evaluators,
      workflows: dependencies.workflows,
      dataset: dependencies.dataset,
    },
  });

  const authz = authzPermissions(dependencies.permissions);
  const services = executionDataServices(dependencies);
  const runLoop = buildExperimentRunLoop({
    redis,
    publicBaseUrl,
    processName: input.processName,
    runConcurrency: input.runConcurrency,
    logger,
    experiments,
    services,
    attachments: attachmentInputs({
      storedObjects: dependencies.storedObjects,
      policy: input.attachmentEgress,
    }),
    connectedAgentOwnership: dependencies.suite,
    dependencies,
  });

  const targetNames = ExperimentWorkbenchTargetNamesService.create();
  const targetEntities = ExperimentTargetEntityNamesService.create({
    agents: dependencies.agents,
    evaluators: dependencies.evaluators,
  });

  return {
    experiments,
    slugify: slugifyExperimentName,
    workbenchTargetNames: (input) =>
      targetNames.resolve({ ...input, prompts: dependencies.prompts, entities: targetEntities }),
    workflows: dependencies.workflows,
    dataset: dependencies.dataset,
    monitors: monitorCascade(dependencies.monitors),
    broadcast: inProcessBroadcast(),
    permissions: authz,
    people: PrismaExperimentPeopleRepository.create(prisma),
    modelCosts: modelCostCatalogue(dependencies.modelProviders),
    workflowAuthoring: workflowAuthoring(dependencies.workflows),
    runLoop,
    workflowEvaluations: WorkflowEvaluationService.create({
      experiments,
      workflowSource: services.workflows,
      services,
      runLoop,
      requests: execution,
      baseUrl: publicBaseUrl,
    }),
    workbenchObserver: loggedObserver(logger),
  };
}

/** Where a run is recorded and an unnamed workbench failure reported. Both best-effort. */
function loggedObserver(logger: Logger): ExperimentWorkbenchObserver {
  return {
    recordExperimentRan: (input) => {
      logger.debug(input, "an experiment ran; no product-analytics sink is composed to record it");
    },
    reportError: (error, context) => {
      logger.error({ error, ...context }, "an unnamed workbench failure");
    },
  };
}
