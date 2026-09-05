/**
 * The wizard, the workbench and the runs behind both, composed as their own feature.
 */
import { TupleParam } from "@clickhouse/client";
import type { ClickHouseClient } from "@clickhouse/client";
import type { AgentService } from "@langwatch/agent-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { DatasetExperimentLookup } from "@langwatch/dataset-server";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { EventSourcing } from "@langwatch/eventing";
import {
  ExperimentApp,
  ExperimentDspyRetentionPort,
  PostgresExperimentAdapter,
  workbenchStateSchema,
  type ExperimentBroadcast,
  type ExperimentTrpcPorts,
} from "@langwatch/experiment-server";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PromptService } from "@langwatch/prompt-contract";
import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import { WorkflowVersionRequiredError } from "@langwatch/workflow-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { WorkflowApp } from "@langwatch/workflow-server";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import {
  composeApiExperimentRun,
  composeApiExperimentRunCommands,
  type ApiExperimentRun,
  type ApiExperimentRunAbsenceReport,
} from "../../app/api-experiment-run.composition";
import { permissiveCoerceMonitorMappings } from "../trace/trace-mappings";
import { createExperimentTrpcRouter } from "./experiment-trpc.mount";

/**
 * The retention floor a DSPy run read is bounded by when a project names no policy of its
 * own. The platform app's `PLATFORM_DEFAULT_RETENTION_DAYS`.
 */
const DEFAULT_RETENTION_DAYS = 49;

/**
 * The slug an experiment is saved under, as every slugged resource derives it.
 */
export const slugifyExperimentName = (value: string): string =>
  value
    .replaceAll(/[:?&_]/g, "-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The other features' services an experiment and its runs reach. */
export type ExperimentPeers = Readonly<{
  /** The studio application a wizard experiment writes its versions through. */
  workflowApp: WorkflowApp;
  /** The studio graph service a run dispatches on. */
  workflows: WorkflowService;
  /** The ONE dataset service a run loads its rows through. */
  datasets: DatasetService;
  /** The monitor service an experiment upserts its own monitor through. */
  monitors: MonitorService;
  /** The evaluators a run scores its cells with. */
  evaluators: EvaluatorService;
  /** The agents a wizard references and a run resolves. */
  agents: AgentService;
  /** The gateway a run's dispatch and its price table read. */
  modelProviders: ModelProviderService;
  /** Reports a cell's result onto the evaluation pipeline. */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<unknown>;
}>;

/** The namespace, the `ctx.app.experiments` application and the run loop. */
export type ComposedExperimentFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createExperimentTrpcRouter>;
  /** For `ctx.app.experiments`, and for the packaged experiment REST family. */
  app: ExperimentApp;
  /** The experiment lookup a dataset resolves a borrowed name through. */
  experimentLookup: DatasetExperimentLookup;
  /** The run loop the three REST run doors dispatch through. */
  run: ApiExperimentRun;
  /**
   * The experiment service itself, where this process composed one.
   */
  experiments?: ExperimentService | undefined;
}>;

/** Composes the experiment surface and its run loop over this process's graph. */
export function composeExperimentFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: ExperimentPeers;
  /** Names this process in a refusal a stand-in raises. */
  processName: string;
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** The producer-only eventing runtime a run's history is written on. */
  eventing: EventSourcing | undefined;
  /** Where the NLP engine answers; absent means every cell refuses at dispatch. */
  nlpServiceUrl: string | undefined;
  /** This deployment's public origin, for the shareable results link. */
  publicBaseUrl: string | undefined;
  /** The queue's Redis, where a run's abort flag and its progress both live. */
  redis?: RedisConnection | null;
  /** The credential a run lends the code it executes. */
  apiKeys?: ApiKeyService;
  /** The live-update channel a workbench cell is broadcast on. */
  broadcast?: ExperimentBroadcast;
  /** The canonicaliser for a monitor's stored mappings, from the trace registry. */
  coerceMonitorMappings?: (mappings: unknown) => unknown;
  /** Names the run loop's own absences at boot rather than leaving them inferred. */
  runReport?: ApiExperimentRunAbsenceReport;
}): ComposedExperimentFeature {
  const logger = createLogger("langwatch:api:experiment");
  const { prisma, authz } = options.infrastructure;

  // The run-history dispatchers, from a PRODUCER-only registration of the same
  // packaged definition the worker drains. Composed BEFORE the Experiment
  // service because the service is what validates and sends on them.
  const experimentRunCommands = composeApiExperimentRunCommands({
    eventing: options.eventing,
    processName: options.processName,
  });

  // A run resolves a prompt handle through the same rows the workbench read
  // resolves, so one service answers both: two would be two answers to which
  // version a handle points at.
  const prompts: PromptService = PostgresPromptAdapter.create({
    database: prisma,
    modelProvider: options.peers.modelProviders,
  }).build();

  const experiments = PostgresExperimentAdapter.create({
    database: prisma,
    // The adapter's own contract: `null` is a deployment without ClickHouse,
    // and its repository answers the refusal rather than this composition
    // guessing at one.
    resolveClickHouseClient: async (projectId) =>
      options.resolveClickHouseClient ? await options.resolveClickHouseClient(projectId) : null,
    tupleParam: (values) => new TupleParam(values),
    dspyRetention: FixedExperimentDspyRetention.create(DEFAULT_RETENTION_DAYS),
    runHistoryTelemetry: LoggedExperimentRunHistoryTelemetry.create(logger),
    slugify: slugifyExperimentName,
    newId: () => nanoid(8),
    references: {
      prompts,
      agents: options.peers.agents,
      evaluators: options.peers.evaluators,
      workflows: options.peers.workflows,
      dataset: options.peers.datasets,
    },
    // The run's history, written through this process's own producer-only
    // registration. Absent only where the process composed no command queue,
    // and then the packaged `UnavailableExperimentExecutionAdapter` refuses by
    // name — which is what stops a run at its first cell rather than letting
    // it produce a history with a hole at the front.
    ...(experimentRunCommands ? { execution: experimentRunCommands } : {}),
    // Still no `updates`: this process broadcasts no cell, so a workbench cell
    // lands on the next read rather than as it happens. That is the packaged
    // no-op's documented shape, not a gap this composition is papering over.
  });

  const app = ExperimentApp.create({
    experiments,
    workflows: options.peers.workflows,
    dataset: options.peers.datasets,
    monitors: options.peers.monitors,
    broadcast: options.broadcast ?? NO_BROADCAST,
  });

  // The run loop, over the SAME services the namespace answers from. A second
  // Experiment, workflow or dataset service built for a run would be a second
  // answer to what an experiment holds.
  const run = composeApiExperimentRun({
    prisma,
    processName: options.processName,
    modelProviders: options.peers.modelProviders,
    nlpServiceUrl: options.nlpServiceUrl,
    publicBaseUrl: options.publicBaseUrl,
    redis: options.redis,
    experiments,
    workflows: options.peers.workflows,
    reportEvaluation: options.peers.reportEvaluation,
    datasets: options.peers.datasets,
    prompts,
    agents: options.peers.agents,
    evaluators: options.peers.evaluators,
    apiKeys: options.apiKeys,
    ...(options.runReport ? { report: options.runReport } : {}),
  });

  const workflowApp = options.peers.workflowApp;

  const ports: ExperimentTrpcPorts<unknown> = {
    workbenchStateSchema:
      workbenchStateSchema as ExperimentTrpcPorts<unknown>["workbenchStateSchema"],
    slugify: slugifyExperimentName,
    saveWorkflowVersion: (ctx, input) => workflowApp.saveStudioVersion(input, { id: actorId(ctx) }),
    /**
     * A copy whose SOURCE has no version cannot be copied, and the studio renders that as
     * "not found" rather than as a failure of the copy.
     */
    copyWorkflowWithDatasets: async (_ctx, input) => {
      try {
        return await workflowApp.copyStudioWorkflow(input);
      } catch (error) {
        if (error instanceof WorkflowVersionRequiredError) {
          throw new NotFoundError(
            "workflow_version_not_found",
            "Workflow version",
            input.workflow.id,
          );
        }
        throw error;
      }
    },
    coerceMonitorMappings: options.coerceMonitorMappings ?? permissiveCoerceMonitorMappings,
    upsertExperimentMonitor: async (_ctx, { projectId, experimentId, monitor }) =>
      await options.peers.monitors.upsertForExperiment({
        projectId,
        experimentId,
        name: monitor.name,
        checkType: monitor.checkType,
        slug: monitor.slug,
        preconditions: monitor.preconditions,
        parameters: monitor.parameters,
        mappings: monitor.mappings,
        sample: monitor.sample,
        enabled: monitor.enabled,
        executionMode: monitor.executionMode,
      } as Parameters<MonitorService["upsertForExperiment"]>[0]),

    probeProjectPermission: (ctx: unknown, projectId: string, permission: AuthzPermission) =>
      authz.hasPermission({ userId: actorId(ctx), permission, projectId }),

    createWorkflow: async (_ctx, input) =>
      await prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId: input.projectId,
          name: input.name,
          icon: input.icon ?? "",
          description: input.description ?? "",
        },
      }),

    tryFindWorkflow: async (_ctx, input) =>
      await prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      }),

    resolveAuthorNames: async (_ctx, authorIds) =>
      await prisma.user.findMany({
        where: { id: { in: [...authorIds] } },
        select: { id: true, name: true },
      }),
  };

  return {
    app,
    experiments,
    experimentLookup: experiments,
    run,
    router: (mount) => createExperimentTrpcRouter({ ...mount, ports }),
  };
}

/**
 * The experiment surface on a process that composed no graph to run it over. The
 * namespace still mounts and every call refuses by name, so the wizard says the
 * deployment cannot answer rather than showing a project no experiments at all.
 */
export function refusingExperimentFeature(): ComposedExperimentFeature {
  const refuse = (): never => {
    throw new ApiExperimentUnavailableError("experiment graph");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<ExperimentApp>(),
    experimentLookup: refuseEvery<DatasetExperimentLookup>(),
    run: refuseEvery<ApiExperimentRun>(),
    router: (mount) =>
      createExperimentTrpcRouter({ ...mount, ports: refuseEvery<ExperimentTrpcPorts<unknown>>() }),
  };
}

/** The experiment graph reached on a process that composed none. */
export class ApiExperimentUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiExperimentUnavailableError";
  }
}

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/** A deployment with no live-update channel: a workbench cell lands on read. */
const NO_BROADCAST: ExperimentBroadcast = (() => {
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
})();

/**
 * The DSPy retention floor, fixed for this process.
 */
class FixedExperimentDspyRetention extends ExperimentDspyRetentionPort {
  static create(days: number): FixedExperimentDspyRetention {
    return new FixedExperimentDspyRetention(days);
  }

  private constructor(private readonly days: number) {
    super();
  }

  getTraceRetentionDays(_tenantId: string): Promise<number> {
    return Promise.resolve(this.days);
  }
}

/**
 * Run-history telemetry, as this process reports it. The trace wrapper is a pass-through:
 * this process's tracer wraps the REQUEST, and a second span per run-history read would
 * only restate the request it is already inside.
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
