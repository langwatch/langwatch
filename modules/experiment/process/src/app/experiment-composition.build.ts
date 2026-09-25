import { EventEmitter } from "node:events";

/**
 * Builds what `apps/api/src/features/experiment/experiment.composition.ts`
 * (deleted by b383462d96) used to hand-compose. See the handoff for the run
 * loop's own scope: `ports`/`progress` stay `null` on purpose.
 */
import { TupleParam, type ClickHouseSettings } from "@clickhouse/client";
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { ExperimentRunStateStore } from "../eventing/experiment-run-state.store.ts";
import { ClickHouseExperimentDspyRepository } from "../repositories/clickhouse/clickhouse.experiment-dspy.repository.ts";
import {
  ClickHouseExperimentRunProcessingRepository,
  type ExperimentRunProcessingPipeline,
} from "../repositories/clickhouse/clickhouse.experiment-run-processing.repository.ts";
import { ClickHouseExperimentRunRepository } from "../repositories/clickhouse/clickhouse.experiment-run.repository.ts";
import { ExperimentDspyRetentionRepository } from "../repositories/experiment-dspy-retention.repository.ts";
import type { ExperimentIdLookupRepository } from "../repositories/experiment-id-lookup.repository.ts";
import { PrismaExperimentPeopleRepository } from "../repositories/prisma/prisma.experiment-people.repository.ts";
import { PrismaExperimentWorkflowVersionRepository } from "../repositories/prisma/prisma.experiment-workflow-version.repository.ts";
import { PrismaExperimentRepository } from "../repositories/prisma/prisma.experiment.repository.ts";
import { RedisExperimentRunProcessingRepository } from "../repositories/redis/redis.experiment-run-processing.repository.ts";
import { RedisExperimentRunProgressRepository } from "../repositories/redis/redis.experiment-run-progress.repository.ts";
import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../services/experiment-execution-data.service.ts";
import { type ExperimentExecution, ExperimentService } from "../services/experiment.service.ts";
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

/** Cells in flight at once when a run names no limit of its own. */
const RUN_DEFAULT_CONCURRENCY = 10;

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
 * The capability this process composed no builder for. A plain `Error`, not a
 * `HandledError` — see the handoff's `Risks` for why.
 */
class ExperimentCapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`This deployment has no ${capability}.`);
    this.name = "ExperimentCapabilityUnavailableError";
  }
}

/** A door this deployment composed nothing behind. Every member REJECTS. */
function refusing<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => (): Promise<never> =>
        Promise.reject(new ExperimentCapabilityUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
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

/**
 * `experiment_run_processing`, ported from the deleted `ExperimentWorkerFeatureInstaller`:
 * the run fold caches through Redis where this deployment has one, and reads ClickHouse uncached
 * otherwise.
 */
export function buildExperimentRunProcessing(input: {
  clickhouse: ClickHouseQueryClient;
  redis: ProcessMembers["redis"] | undefined;
  defaultRetentionDays: () => number;
}): ExperimentRunProcessingPipeline {
  const { redis, defaultRetentionDays } = input;
  const resolveClient = memberSessionResolver(input.clickhouse);
  if (redis) {
    return RedisExperimentRunProcessingRepository.create({
      resolveClient,
      defaultRetentionDays,
      redis,
    }).buildProcessing();
  }

  const eventing = ClickHouseExperimentRunProcessingRepository.create({
    resolveClient,
    clickhouseEnabled: true,
  });
  return ClickHouseExperimentRunProcessingRepository.pipeline({
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

export function buildExperimentInfrastructure(input: {
  prisma: ProcessMembers["prisma"];
  clickhouse: ClickHouseQueryClient;
  /** Where a run's progress is written and polled; shared across replicas. */
  redis: ProcessMembers["redis"] | undefined;
  logger: Logger;
  /** Where a run's writes are sent: the run pipeline's own senders. */
  execution: ExperimentExecution;
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
  };
}): Omit<ExperimentAppDependencies, "runLookup"> {
  const { prisma, clickhouse, redis, logger, execution, dependencies } = input;
  const resolveClient = memberSessionResolver(clickhouse);
  const runHistoryTelemetry = LoggedExperimentRunHistoryTelemetry.create(logger);
  const tupleParam = (values: string[]) => new TupleParam(values);

  const experiments = ExperimentService.create({
    repository: PrismaExperimentRepository.create(prisma),
    runRepository: ClickHouseExperimentRunRepository.create({
      workflowVersions: PrismaExperimentWorkflowVersionRepository.create(prisma),
      resolveClient,
      tupleParam,
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
  const services: ExecutionDataServices = {
    datasets: dependencies.dataset,
    prompts: dependencies.prompts,
    agents: dependencies.agents,
    evaluators: dependencies.evaluators,
    workflows: refusing<ExperimentWorkflowDsl>("workflow-backed experiment execution"),
    entitlements: dependencies.entitlement,
    projects: dependencies.projects,
  };
  const runLoop: ExperimentV3RunLoop = {
    ports: null,
    // The READ half, derivable from the deployment's own Redis: a poll of a
    // run this process did not start is still this process's to answer.
    // `ports` stays null — starting a run belongs to the worker.
    progress: redis ? RedisExperimentRunProgressRepository.create({ redis }) : null,
    services,
    // The orchestrator's own collaborator, server-private to the workflow
    // module. This process composes no run loop, so nothing behind it is
    // ever called; see `services.workflows` above for the same refusal.
    workflows: refusing<WorkflowApi>("workflow-backed experiment execution"),
    defaultConcurrency: RUN_DEFAULT_CONCURRENCY,
    startRun: () => Promise.reject(new ExperimentCapabilityUnavailableError("experiment run loop")),
  };

  return {
    experiments,
    slugify: slugifyExperimentName,
    workflows: dependencies.workflows,
    dataset: dependencies.dataset,
    monitors: monitorCascade(dependencies.monitors),
    broadcast: inProcessBroadcast(),
    permissions: authz,
    people: PrismaExperimentPeopleRepository.create(prisma),
    modelCosts: refusing<ExperimentModelCosts>("model cost catalogue"),
    workflowAuthoring: refusing<ExperimentWorkflowAuthoring>("wizard workflow authoring"),
    runLoop,
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
