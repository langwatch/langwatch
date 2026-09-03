import type { AnalyticsService } from "@langwatch/analytics-contract";
import { REPORT_SCHEDULER_TARGET_TYPE } from "@langwatch/automation-contract";
import {
  AutomationClockPort,
  PostgresAutomationGraphDeliveryAdapter,
  PrismaCustomGraphRepository,
  PrismaTriggerFireHistoryRepository,
  PrismaTriggerRepository,
  ReportScheduleService,
  ScheduledJobStorePort,
  SchedulerWakePort,
  SlackProviderAdapter,
  dispatchScheduledReport,
  loadReportCharts,
  toReportTraceRow,
  type ReportDispatchDeps,
  type ScheduledJobRecord,
} from "@langwatch/automation-server";
import {
  PrismaScheduledJobStore,
  SchedulerRegistry,
  SchedulerService,
  type ScheduledJobStore,
} from "@langwatch/eventing/server";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  ClickHouseEvaluationRepository,
  EvaluationRetentionFloorPort,
} from "@langwatch/evaluation-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { RedisConnection } from "@langwatch/redis-client";
import type { TopicService } from "@langwatch/topic-contract";
import {
  TraceListClickHouseRepository,
  TraceListService,
  TraceQueryClickHouse,
} from "@langwatch/trace-server";
import type { ReportTraceRow } from "@langwatch/automation-contract";
import type { WorkerAutomationDeliveryComposition } from "./worker-automation-graph.composition";
import type { AutomationProjectIdentityPort } from "@langwatch/automation-server";

/**
 * What a scheduled report reads its traces through.
 *
 * Narrow on purpose. A trace-query report asks trace storage ONE question —
 * the top rows matching the author's saved query over the report's window —
 * and the reader that answers it is a ClickHouse repository plus the evaluation
 * summaries a row is labelled with. Naming the question rather than the whole
 * trace-list capability is what keeps this composition free of the topic
 * enrichment and facet machinery a report never renders.
 */
export abstract class WorkerReportTraceListPort {
  abstract listReportTraces(input: {
    projectId: string;
    projectSlug: string;
    query: string;
    from: number;
    to: number;
    limit: number;
  }): Promise<ReportTraceRow[]>;
}

/**
 * The traces a report lists, over a trace-list reader this process composes.
 *
 * `toReportTraceRow` is the feature's own mapper rather than a second copy of
 * it here: the report's row shape (a snipped input, a numeric cost, a deep
 * link) is what the templates render, and two mappers would let a report and
 * the traces page disagree about the same trace.
 */
export class ComposedWorkerReportTraceList extends WorkerReportTraceListPort {
  static create(input: {
    /** Reads a page of matching traces. `TraceListService`, narrowed. */
    traces: {
      getList(params: {
        tenantId: string;
        timeRange: { from: number; to: number };
        sort: { columnId: string; direction: "asc" | "desc" };
        page: number;
        pageSize: number;
        visibilityCutoffMs: number | null;
        filterWhere?: { sql: string; params: Record<string, unknown> };
      }): Promise<{ items: unknown[] }>;
    };
    /** Compiles the author's saved query into the reader's own predicate. */
    translateFilter(
      query: string,
      projectId: string,
      window: { from: number; to: number },
    ): { sql: string; params: Record<string, unknown> } | null;
    baseHost: string;
  }): ComposedWorkerReportTraceList {
    return new ComposedWorkerReportTraceList(input.traces, input.translateFilter, input.baseHost);
  }

  private constructor(
    private readonly traces: Parameters<typeof ComposedWorkerReportTraceList.create>[0]["traces"],
    private readonly translateFilter: Parameters<
      typeof ComposedWorkerReportTraceList.create
    >[0]["translateFilter"],
    private readonly baseHost: string,
  ) {
    super();
  }

  async listReportTraces(input: {
    projectId: string;
    projectSlug: string;
    query: string;
    from: number;
    to: number;
    limit: number;
  }): Promise<ReportTraceRow[]> {
    // The Subject facet (ADR-043) — the same query the author writes and
    // previews in the drawer, compiled into the reader's own predicate. An
    // empty query means the whole window, so it compiles to no predicate.
    const filterWhere = this.translateFilter(input.query, input.projectId, {
      from: input.from,
      to: input.to,
    });
    const page = await this.traces.getList({
      tenantId: input.projectId,
      timeRange: { from: input.from, to: input.to },
      sort: { columnId: "time", direction: "desc" },
      page: 1,
      pageSize: input.limit,
      visibilityCutoffMs: null,
      ...(filterWhere ? { filterWhere } : {}),
    });
    const projectUrl = `${this.baseHost}/${input.projectSlug}`;
    return page.items.map((item) => toReportTraceRow({ item: item as never, projectUrl }));
  }
}

/**
 * The trace reader a report lists through, composed over this process's own
 * ClickHouse.
 *
 * `TraceListService` is the one implementation of that read, so it is composed
 * rather than re-issued: the retention floor, the visibility teaser and the
 * evaluation labels a row carries are that service's correctness, and a second
 * query here is how a report starts disagreeing with the traces page it links
 * to. Its two other collaborators are answered honestly — evaluation summaries
 * from Evaluation's own ClickHouse repository, and a topic reader that refuses
 * by name because a list read never asks it anything (only facet enrichment
 * does, and a report renders no facets).
 */
export function createWorkerReportTraceList(options: {
  resolveClickHouseClient: Parameters<typeof TraceListClickHouseRepository.create>[0];
  /** The event store's own retention default, so both read to the same day. */
  defaultRetentionDays: number;
  baseHost: string;
}): WorkerReportTraceListPort {
  const evaluations = ClickHouseEvaluationRepository.create({
    resolveClient: options.resolveClickHouseClient as unknown as Parameters<
      typeof ClickHouseEvaluationRepository.create
    >[0]["resolveClient"],
    retentionFloor: new ReportRetentionFloor(options.defaultRetentionDays),
  });

  return ComposedWorkerReportTraceList.create({
    traces: new TraceListService(
      TraceListClickHouseRepository.create(options.resolveClickHouseClient),
      Object.assign(refuseReportRead<EvaluationService>("the evaluation runs behind a trace"), {
        findSummariesByTraceIds: (
          input: Parameters<typeof evaluations.findSummariesByTraceIds>[0],
        ) => evaluations.findSummariesByTraceIds(input),
      }),
      refuseReportRead<TopicService>("the topic names a facet is labelled with"),
    ),
    translateFilter: (query, projectId, window) =>
      TraceQueryClickHouse.translateFilter(query, projectId, window),
    baseHost: options.baseHost,
  });
}

/**
 * A stand-in whose every member refuses by name.
 *
 * A proxy rather than an object literal because these are collaborator
 * interfaces another package declared: writing out each member would be a
 * second declaration of somebody else's interface, and the copy is what goes
 * stale when the real one grows a method.
 */
function refuseReportRead<T extends object>(capability: string): T {
  return new Proxy({} as T, {
    get: () => () => {
      throw new Error(
        `A scheduled report asked for ${capability}, which the report calendar composes no reader for.`,
      );
    },
    has: () => true,
  });
}

/**
 * The floor an evaluation read will not look below, from the one retention
 * default this process configures its event store with.
 */
class ReportRetentionFloor extends EvaluationRetentionFloorPort {
  constructor(private readonly defaultRetentionDays: number) {
    super();
  }

  async getFloorMs(): Promise<number> {
    return Date.now() - this.defaultRetentionDays * 24 * 60 * 60 * 1000;
  }
}

export type WorkerReportScheduleCompositionOptions = Readonly<{
  /** The typed client this process opened; the calendar row lives in it. */
  connection: PrismaConnection;
  /** The process's own wall clock, as Automation reads time. */
  clock: AutomationClockPort;
  /** The transports and cipher both halves of Automation already share. */
  delivery: WorkerAutomationDeliveryComposition;
  /** The name and slug a report's links and headings are written with. */
  projects: AutomationProjectIdentityPort;
  /** The timeseries each chart panel is plotted from. */
  analytics: AnalyticsService;
  /** How a trace-query report reads the rows it sends. */
  traces: WorkerReportTraceListPort;
  /** This deployment's public origin. Every link in the message goes through it. */
  baseHost: string;
  /** Best-effort cross-pod wake. Absent leaves the poll backstop, never correctness. */
  redis?: RedisConnection | null;
  logger?: Logger;
}>;

/** The report calendar this process runs, as the installer starts and stops it. */
export type WorkerReportSchedule = Readonly<{
  start(): void;
  stop(): Promise<void>;
}>;

/**
 * The scheduled-report calendar, composed from what this process already holds.
 *
 * WHAT WAS MISSING. `dispatchScheduledReport` is Automation's own handler and
 * it had no caller anywhere in the tree: the loop that claims a due
 * `ScheduledJob` and the registration that maps `reportTrigger` onto the
 * handler both lived in the deleted application's composition root, so every
 * scenario in `specs/monitors/report-content.feature` described code nothing
 * could reach. A report could be authored, saved and shown a next-run time,
 * and never send.
 *
 * WHAT IT IS. ADR-044 §4's in-process calendar: a worker-only loop that sleeps
 * until the soonest due row, atomically leases it, and fires it into the
 * handler registered for its `targetType`. Correctness is one Postgres
 * conditional update, so every worker runs the loop and races the lease rather
 * than one pod holding a leader lock.
 *
 * THE REGISTRY IS THIS COMPOSITION'S OWN, not the module singleton. A process
 * singleton throws on a second registration of the same `targetType`, so a
 * suite that composes the graph twice — or a deployment that ever composed two
 * — would fail on the second boot rather than on the mistake. One registry per
 * composed calendar keeps the throw meaningful.
 *
 * IT RECONCILES AT BOOT, and on this branch that is load-bearing rather than a
 * self-heal: the interactive process composes `PostgresAutomationAdapter` with
 * a `ScheduledJobStorePort` whose `upsertForTarget` refuses by name, so a
 * report saved there writes its `Trigger` row and no calendar row at all. The
 * reconcile sweep is create-if-missing and race-safe across the fleet, so it is
 * what gives an authored report a slot to be claimed.
 */
export function createWorkerReportSchedule(
  options: WorkerReportScheduleCompositionOptions,
): WorkerReportSchedule {
  const logger = options.logger ?? createLogger("langwatch:worker:report-schedule");
  const database = options.connection.client;
  const jobs = new PrismaScheduledJobStore(database);
  const triggers = PrismaTriggerRepository.create(database, options.clock);
  const fires = PrismaTriggerFireHistoryRepository.create(database);
  const customGraphs = PrismaCustomGraphRepository.create(database);
  // The SAME suppression read a graph alert filters its recipients through: an
  // unsubscribe one half of Automation honoured and the other ignored is a
  // customer who unsubscribed and still gets mail.
  const graphDelivery = PostgresAutomationGraphDeliveryAdapter.create({
    database,
    clock: options.clock,
  });
  const schedules = ReportScheduleService.create({
    jobs: WorkerReportScheduleJobs.create(jobs),
    clock: options.clock,
    wake: new WorkerSchedulerWake(options.redis ?? null),
    triggers,
  });

  const deps: ReportDispatchDeps = {
    loadTrigger: ({ projectId, triggerId }) => triggers.tryFindById({ triggerId, projectId }),
    loadProject: (projectId) => options.projects.tryGetById(projectId),
    delivery: options.delivery.delivery,
    slackProvider: SlackProviderAdapter.create(options.delivery.crypto),
    filterSuppressedRecipients: (input) => graphDelivery.filterSuppressed(input),
    listReportTraces: (input) => options.traces.listReportTraces(input),
    loadReportCharts: ({ projectId, source, from, to }) =>
      loadReportCharts({
        deps: {
          loadCustomGraph: ({ projectId: project, customGraphId }) =>
            customGraphs.tryFindById({ customGraphId, projectId: project }),
          loadDashboardGraphs: ({ projectId: project, dashboardId }) =>
            customGraphs.findAllByDashboardId({ dashboardId, projectId: project }),
          getTimeseries: (input) => options.analytics.getTimeseries(input),
        },
        source,
        projectId,
        from,
        to,
      }),
    // A report's fire is a completed EVENT, not an open incident, so
    // `resolvedAt` is stamped at write time. The automations list reads
    // "currently firing" as `customGraphId != null AND resolvedAt IS NULL`, so
    // a report row can never masquerade as a live alert.
    recordFire: async ({ projectId, triggerId, firedAt }) => {
      await fires.create({
        projectId,
        triggerId,
        traceId: null,
        customGraphId: null,
        createdAt: firedAt,
        resolvedAt: firedAt,
      });
    },
    baseHost: options.baseHost,
  };

  const registry = new SchedulerRegistry();
  registry.register({
    targetType: REPORT_SCHEDULER_TARGET_TYPE,
    handler: (fire) => dispatchScheduledReport({ deps, fire }),
  });

  const scheduler = new SchedulerService({
    repo: jobs,
    registry,
    // This composition is only built where the worker stack runs, so the
    // decision the loop gates on is already made by the time it is handed one.
    runsWorkers: true,
    logger,
    ...(options.redis ? { redis: options.redis as never } : {}),
  });

  return {
    start(): void {
      scheduler.start();
      // Fire-and-forget so boot is never blocked by a sweep; a failure is
      // logged and the next boot retries it.
      void schedules
        .reconcile()
        .then(({ repaired }) => {
          if (repaired > 0) {
            logger.info({ repaired }, "Repaired report schedules missing a calendar row");
          }
        })
        .catch((error: unknown) => {
          logger.error({ error }, "Report schedule reconciliation failed");
        });
    },
    stop(): Promise<void> {
      return scheduler.stop();
    },
  };
}

/**
 * Automation's three-method calendar port, over Eventing's `ScheduledJob` store.
 *
 * The two packages describe the same table from opposite ends — Automation
 * writes a report's slot, Eventing claims and settles it — and this is the one
 * place they meet. It is a narrowing rather than a second store: a schedule
 * written through anything but the row the loop scans would come due nowhere.
 */
class WorkerReportScheduleJobs extends ScheduledJobStorePort {
  static create(store: ScheduledJobStore): WorkerReportScheduleJobs {
    return new WorkerReportScheduleJobs(store);
  }

  private constructor(private readonly store: ScheduledJobStore) {
    super();
  }

  upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }): Promise<void> {
    return this.store.upsertForTarget(input);
  }

  deactivateForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void> {
    return this.store.deactivateForTarget(input);
  }

  async findAllForProject(input: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]> {
    const rows = await this.store.findAllForProject(input);
    return rows.map((row) => ({
      targetId: row.targetId,
      nextRunAt: row.nextRunAt,
      lastSlot: row.lastSlot,
      active: row.active,
    }));
  }
}

/**
 * The cross-pod wake a newly written schedule publishes, best-effort.
 *
 * Postgres is the correctness layer: a dropped publish or an absent Redis costs
 * only the time to the next poll backstop, never a fire.
 */
class WorkerSchedulerWake extends SchedulerWakePort {
  constructor(private readonly redis: RedisConnection | null) {
    super();
  }

  publish(): void {
    SchedulerService.publishWake(this.redis as never);
  }
}
