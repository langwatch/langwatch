/**
 * The real-time evaluations running against a project's traffic, installed over
 * this process's own graph.
 */
import { AnalyticsComparisonWindowService } from "@langwatch/analytics-server";
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import type { MonitorPerformanceQuery } from "@langwatch/evaluation-contract";
import {
  MonitorPerformanceAdapter,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { EvaluatorReplicationService } from "@langwatch/evaluator-server";
import { HandledError } from "@langwatch/handled-error";
import {
  monitorServer,
  MonitorEvaluatorPort,
  MonitorPerformancePort,
  MonitorReplicationPort,
} from "@langwatch/monitor-server";
import { createApp } from "@langwatch/runtime-composition";
import { nanoid } from "nanoid";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createMonitorTrpcRouter } from "./monitor-trpc.mount.ts";
import type { ComposedMonitorFeature } from "./monitor.composition.types.ts";

/**
 * Copying an evaluator's backing workflow, as this process performs it.
 *
 * The workflow half belongs to the Workflow feature and is resolved per
 * request there; the monitor asks for it by naming the person the copy is
 * recorded against, so nothing about a tRPC context reaches this feature.
 */
export type MonitorWorkflowReplication = Readonly<{
  replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actor: Readonly<{ id: string }>;
    }>,
  ): Promise<string>;
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

/** The other features' services the monitor surface reaches, named one by one. */
export type MonitorPeers = Readonly<{
  /** The caller's own grants, for the standing a declared check cannot cover. */
  permissions: AuthzApiContract;
  /** The evaluator a monitor runs, through the ONE evaluator service. */
  evaluators: EvaluatorService;
  /**
   * The evaluator replication the product-group half already built over this
   * process's workflow application. Taken rather than rebuilt, because a second
   * replication would be a second answer to what copying an evaluator does to
   * the graph behind it.
   */
  workflowReplication: MonitorWorkflowReplication;
}>;

/** Installs the monitor surfaces over this process's own graph. */
export async function installApiMonitor(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: MonitorPeers;
  /** The routed ClickHouse the seven-day trend is read on, or null where there is none. */
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
}): Promise<ComposedMonitorFeature> {
  const { prisma } = options.infrastructure;
  const { permissions, evaluators, workflowReplication } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(AuthzApi, permissions)
    .withFeature(monitorServer, {
      infrastructure: {
        evaluators: new ProcessMonitorEvaluators(evaluators),
        performance: composeMonitorPerformance(options.resolveClickHouseClient),
        replication: new ProcessMonitorReplication(evaluators, workflowReplication),
        generateId: () => `monitor_${nanoid()}`,
      },
    })
    .boot({ role: "api" });

  const app = runtime.feature(monitorServer).provided;

  return {
    routers: (mount) => ({ monitors: createMonitorTrpcRouter(mount.runtime) }),
    app,
    restServices: { monitors: () => app },
  };
}

/** The one evaluator service on this process, as the monitor reads it. */
class ProcessMonitorEvaluators extends MonitorEvaluatorPort {
  constructor(private readonly evaluators: EvaluatorService) {
    super();
  }

  getById(input: { id: string; projectId: string }) {
    return this.evaluators.getById(input);
  }

  archive(input: { id: string; projectId: string }) {
    return this.evaluators.archive(input);
  }
}

/** The evaluator copy, over the process's own replication of the graph behind it. */
class ProcessMonitorReplication extends MonitorReplicationPort {
  constructor(
    private readonly evaluators: EvaluatorService,
    private readonly workflows: MonitorWorkflowReplication,
  ) {
    super();
  }

  async copyEvaluatorToProject(input: {
    evaluatorId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actor: { id: string };
  }) {
    const copied = await EvaluatorReplicationService.create({
      replicateEvaluatorWorkflow: (replication) =>
        this.workflows.replicateEvaluatorWorkflow({ ...replication, actor: input.actor }),
      deleteReplicatedWorkflow: (replication) =>
        this.workflows.deleteReplicatedWorkflow(replication),
    }).copyToProject({
      evaluators: {
        findById: async (lookup) => (await this.evaluators.tryGetById(lookup)) ?? undefined,
        create: (created) => this.evaluators.create(created),
      },
      evaluatorId: input.evaluatorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });

    return { id: copied.id, workflowId: copied.workflowId };
  }

  deleteReplicatedWorkflow(input: { workflowId: string; projectId: string }) {
    return this.workflows.deleteReplicatedWorkflow(input);
  }
}

/**
 * The seven-day trend, over the SAME routed ClickHouse the object probe reads.
 * `MonitorPerformanceAdapter` composes the read and the fold that turns its
 * buckets into a guardrail's pass rate or an evaluator's mean score; the
 * comparison window is the analytics page's own, so the trend covers the exact
 * runs a reader sees when they open analytics for this evaluation.
 */
function composeMonitorPerformance(
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null,
): MonitorPerformancePort {
  const window = AnalyticsComparisonWindowService.create();
  const previousPeriodStartMs = ({ startMs, endMs }: { startMs: number; endMs: number }) =>
    window.currentVsPrevious({ startDate: startMs, endDate: endMs }).previousPeriodStartDate.getTime();

  if (!resolveClickHouseClient) return new UncomposedMonitorPerformance(previousPeriodStartMs);

  // The one cast this seam takes, and the same one the stored-object port
  // takes: the routed connection is typed `unknown` here so this module does
  // not have to name a ClickHouse client, and each reader states the shape its
  // own package declares.
  const evaluations = MonitorPerformanceAdapter.create({
    resolveClickHouse: resolveClickHouseClient as EvaluationClickHouseResolver,
  });

  return new ClickHouseMonitorPerformance(evaluations, previousPeriodStartMs);
}

class ClickHouseMonitorPerformance extends MonitorPerformancePort {
  constructor(
    private readonly evaluations: { getMonitorPerformance: MonitorPerformancePort["getMonitorPerformance"] },
    private readonly window: (range: { startMs: number; endMs: number }) => number,
  ) {
    super();
  }

  getMonitorPerformance(query: MonitorPerformanceQuery) {
    return this.evaluations.getMonitorPerformance(query);
  }

  previousPeriodStartMs(range: { projectId: string; startMs: number; endMs: number }): number {
    return this.window(range);
  }
}

/** The trend on a deployment that composed no ClickHouse connection. */
class UncomposedMonitorPerformance extends MonitorPerformancePort {
  constructor(private readonly window: (range: { startMs: number; endMs: number }) => number) {
    super();
  }

  getMonitorPerformance(): Promise<never> {
    return Promise.reject(
      new ApiMonitorUnavailableError(
        "The monitor performance trend, because this deployment composed no ClickHouse connection,",
      ),
    );
  }

  previousPeriodStartMs(range: { projectId: string; startMs: number; endMs: number }): number {
    return this.window(range);
  }
}

/** A capability this deployment did not compose, refused by name. */
class ApiMonitorUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiMonitorUnavailableError";
  }
}
