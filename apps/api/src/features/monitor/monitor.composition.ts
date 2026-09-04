/**
 * The real-time evaluations running against a project's traffic, composed as
 * their own feature.
 *
 * `monitors.*` — the monitors a project runs, their seven-day trend, and the
 * copy that replicates one, with its evaluator and that evaluator's workflow,
 * into another project — plus the `ctx.app.monitors` slice the packaged monitor
 * REST family reads.
 *
 * It used to be composed inside the product-infrastructure half beside the
 * object store and the retention policy, on the strength of a shared ClickHouse
 * resolver. A deployment with no byte backend has monitors all the same, so it
 * composes itself now, from the three peers below and this process's ClickHouse.
 *
 * ## The named absence
 *
 * The trend is one ClickHouse read over `evaluation_runs` joined to
 * `trace_summaries`, and `@langwatch/evaluation-server` publishes it as
 * `MonitorPerformanceAdapter` — the service alone, without the evaluator
 * executor and workflow capability `EvaluationAdapter` demands and this read
 * never touches.
 *
 * A deployment with NO ClickHouse has no trend to read, and there it refuses by
 * name rather than answering `[]`: an empty trend reads as "your monitors
 * caught nothing", which is the one answer a person acts on by turning a
 * monitor off.
 */
import { currentVsPreviousDates } from "@langwatch/analytics-server";
import {
  MonitorPerformanceAdapter,
  type EvaluationClickHouseResolver,
  type MonitorPerformanceService,
} from "@langwatch/evaluation-server";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { EvaluatorReplicationApi, type EvaluatorTrpcPorts } from "@langwatch/evaluator-server";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import { monitorPreconditionsSchema, type MonitorService } from "@langwatch/monitor-contract";
import { MonitorApp, type MonitorTrpcPorts } from "@langwatch/monitor-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import { createMonitorTrpcRouter } from "./monitor-trpc.mount";

/** Reports the one capability this feature can be composed without. */
export abstract class ApiMonitorAbsenceReport {
  abstract absent(capability: "clickhouse"): void;
}

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiMonitorAbsence extends ApiMonitorAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiMonitorAbsence {
    return new LoggedApiMonitorAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "clickhouse"): void {
    this.logger.warn(
      { capability },
      "API process composed no ClickHouse connection: the monitors page's seven-day trend refuses by name rather than reporting that no monitor caught anything.",
    );
  }
}

/** The other features' services the monitor surface reaches, named one by one. */
export type MonitorPeers = Readonly<{
  /**
   * The monitor service the execution half already composed, taken rather than
   * built: an experiment upserts its own monitor through that same service, and
   * two would let the monitors list disagree with what an experiment created.
   */
  monitors: MonitorService;
  /**
   * The evaluator service the execution half composed. The monitor copy rolls
   * an evaluator back through it when the monitor insert fails.
   */
  evaluators: EvaluatorService;
  /**
   * The evaluator replication the product-group half already built over this
   * process's workflow application. Taken rather than rebuilt, because a
   * second replication would be a second answer to what copying an evaluator
   * does to the graph behind it.
   */
  evaluatorReplication: Pick<
    EvaluatorTrpcPorts,
    "replicateEvaluatorWorkflow" | "deleteReplicatedWorkflow"
  >;
}>;

/** Everything the monitor surface is composed from besides its peers. */
export type MonitorFeatureCollaborators = MonitorPeers &
  Readonly<{
    /** The routed ClickHouse the trend is read on, or null where there is none. */
    resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
    report?: ApiMonitorAbsenceReport;
  }>;

/** The namespace and the `ctx.app.monitors` slice the REST family reads. */
export type ComposedMonitorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createMonitorTrpcRouter>;
  app: MonitorApp;
}>;

/** Composes the monitor surface over this process's own graph. */
export function composeMonitorFeature(options: {
  peers: MonitorPeers;
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
  report?: ApiMonitorAbsenceReport;
}): ComposedMonitorFeature {
  const collaborators: MonitorFeatureCollaborators = {
    ...options.peers,
    resolveClickHouseClient: options.resolveClickHouseClient,
    ...(options.report ? { report: options.report } : {}),
  };
  if (!collaborators.resolveClickHouseClient) collaborators.report?.absent("clickhouse");
  const composed = composeMonitors(collaborators);

  return {
    router: (mount) => createMonitorTrpcRouter({ ...mount, ports: composed.ports }),
    app: composed.app,
  };
}

/**
 * The monitor surface on a process that composed no evaluator graph.
 *
 * The namespace still mounts and every call refuses by name, so the page says
 * this deployment runs no monitors rather than showing a project an empty list
 * it would read as "nothing is watching".
 */
export function refusingMonitorFeature(): ComposedMonitorFeature {
  const refuse = <T>(): T =>
    new Proxy(
      {},
      {
        get:
          () =>
          (): never => {
            throw new ApiMonitorUnavailableError("The monitor surface");
          },
        has: () => true,
      },
    ) as T;

  return {
    router: (mount) =>
      createMonitorTrpcRouter({
        ...mount,
        ports: {
          // The parser is read while the router is BUILT, so it stays real:
          // a procedure cannot be constructed without its input schema.
          preconditionsSchema: monitorPreconditionsSchema,
          resolvePreviousPeriodStartMs: () => {
            throw new ApiMonitorUnavailableError("The monitor performance trend");
          },
          copyEvaluatorToProject: () => {
            throw new ApiMonitorUnavailableError("Copying a monitor between projects");
          },
          deleteReplicatedWorkflow: () => {
            throw new ApiMonitorUnavailableError("Copying a monitor between projects");
          },
        },
      }),
    app: refuse<MonitorApp>(),
  };
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

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

/**
 * The seven-day trend, over the SAME routed ClickHouse the object probe reads.
 *
 * The trend alone: `MonitorPerformanceAdapter` composes the read and the fold
 * that turns its buckets into a guardrail's pass rate or an evaluator's mean
 * score, and nothing else. `EvaluationAdapter` would compose the same read
 * behind an evaluator executor and a workflow capability this process never
 * asks the trend for.
 *
 * With no connection there is nothing to read, and the answer is a refusal by
 * name rather than an empty trend, which a person would read as "no monitor
 * caught anything" and act on by switching a monitor off.
 */
function composeMonitorPerformance(
  options: MonitorFeatureCollaborators,
): Pick<MonitorPerformanceService, "getMonitorPerformance"> {
  const resolve = options.resolveClickHouseClient;
  if (!resolve) {
    return {
      getMonitorPerformance: () =>
        Promise.reject(
          new ApiMonitorUnavailableError(
            "The monitor performance trend, because this deployment composed no ClickHouse connection,",
          ),
        ),
    };
  }
  // The one cast this seam takes, and the same one the stored-object port
  // takes above: the routed connection is typed `unknown` here so this module
  // does not have to name a ClickHouse client, and each reader states the
  // shape its own package declares.
  return MonitorPerformanceAdapter.create({
    resolveClickHouse: resolve as EvaluationClickHouseResolver,
  });
}

function composeMonitors(options: MonitorFeatureCollaborators): {
  app: MonitorApp;
  ports: MonitorTrpcPorts;
} {
  const app = MonitorApp.create({
    monitors: options.monitors,
    evaluations: composeMonitorPerformance(options),
    evaluators: options.evaluators,
  });

  return {
    app,
    ports: {
      /**
       * The precondition SHAPE, not its vocabulary.
       *
       * Which rules a given field may carry is the trace-filter registry's
       * answer, and that registry now lives in a browser package no server
       * module may value-import. So this parses what the wire has always
       * required and no more: the cross-check between a precondition's field
       * and its rule returns with the registry.
       */
      preconditionsSchema: monitorPreconditionsSchema,
      // The previous window comes from the same helper the analytics page
      // uses, so the trend comparison covers the exact same runs a person sees
      // when they open analytics for this evaluation.
      resolvePreviousPeriodStartMs: ({ startMs, endMs }) =>
        currentVsPreviousDates({
          startDate: startMs,
          endDate: endMs,
        }).previousPeriodStartDate.getTime(),
      copyEvaluatorToProject: (ctx, input) =>
        EvaluatorReplicationApi.create({
          replicateEvaluatorWorkflow: (replication) =>
            options.evaluatorReplication.replicateEvaluatorWorkflow(
              evaluatorContext(ctx),
              replication,
            ),
          deleteReplicatedWorkflow: (replication) =>
            options.evaluatorReplication.deleteReplicatedWorkflow(
              evaluatorContext(ctx),
              replication,
            ),
        }).copyToProject({
          evaluators: options.evaluators,
          ...input,
        }),
      deleteReplicatedWorkflow: (ctx, input) =>
        options.evaluatorReplication.deleteReplicatedWorkflow(evaluatorContext(ctx), input),
    },
  };
}

/**
 * The same request, as the EVALUATOR ports declare their context.
 *
 * The two packages narrow `ctx` to the slice each one reads — the monitor
 * surface names `app.monitors`, the evaluator replication names
 * `app.evaluatorApp` — and this process's real context carries both. Named at
 * the one seam that hands a request from one feature's port signature to
 * another's, so the crossing is written down rather than repeated inline.
 */
function evaluatorContext(
  ctx: unknown,
): Parameters<EvaluatorTrpcPorts["replicateEvaluatorWorkflow"]>[0] {
  return ctx as Parameters<EvaluatorTrpcPorts["replicateEvaluatorWorkflow"]>[0];
}

