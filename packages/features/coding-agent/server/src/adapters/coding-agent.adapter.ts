import {
  CodingAgentProjectionPersistence,
  type CodingAgentService,
  type CodingAgentSession,
  type CodingAgentSessionEventRecord,
  type CodingAgentSessionMetricSeriesRecord,
  type CodingAgentTraceSessionRecord,
} from "@langwatch/coding-agent-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { CodingAgentClickHousePort } from "../ports/coding-agent-clickhouse.port";
import { SystemCodingAgentClock } from "./coding-agent-clock.adapter";
import type { CodingAgentClockPort } from "../ports/coding-agent-clock.port";
import {
  CodingAgentReadMetricsPort,
  NoopCodingAgentReadMetricsPort,
} from "./coding-agent-read-metrics.adapter";
import { CodingAgentSessionEventsClickHouseRepository } from "../repositories/coding-agent-session-event/clickhouse.repository";
import { CodingAgentSessionClickHouseRepository } from "../repositories/coding-agent-session/clickhouse.repository";
import { CodingAgentTraceSessionClickHouseRepository } from "../repositories/coding-agent-trace-session/clickhouse.repository";
import { SessionMetricSeriesClickHouseRepository } from "../repositories/session-metric-series/clickhouse.repository";
import {
  CodingAgentSessionEventRepository,
  NullCodingAgentSessionEventRepository,
} from "../repositories/coding-agent-session-event.repository";
import {
  CodingAgentSessionRepository,
  NullCodingAgentSessionRepository,
} from "../repositories/coding-agent-session.repository";
import {
  CodingAgentTraceSessionRepository,
  NullCodingAgentTraceSessionRepository,
} from "../repositories/coding-agent-trace-session.repository";
import {
  NullSessionMetricSeriesRepository,
  SessionMetricSeriesRepository,
} from "../repositories/session-metric-series.repository";
import { CodingAgentFeatureService } from "../services/coding-agent.service";
import type { CodingAgentBillingPolicyPort } from "../ports/coding-agent-billing.port";

type CodingAgentRepositories = {
  sessions: CodingAgentSessionRepository;
  traceSessions: CodingAgentTraceSessionRepository;
  metricSeries: SessionMetricSeriesRepository;
  sessionEvents: CodingAgentSessionEventRepository;
};

const projectionRepositories = new WeakMap<
  CodingAgentProjectionPersistence,
  CodingAgentRepositories
>();
const projectionClocks = new WeakMap<
  CodingAgentProjectionPersistence,
  CodingAgentClockPort
>();

/**
 * The process-owned persistence adapter installed into Coding Agent's event
 * projections. It is not a second domain service: projection registration is
 * an application lifecycle boundary, while ordinary callers use only
 * CodingAgentService.
 */
export class CodingAgentProjectionPersistenceAdapter extends CodingAgentProjectionPersistence {
  private constructor(
    private readonly repositories: CodingAgentRepositories,
    private readonly clock: CodingAgentClockPort,
  ) {
    super();
  }

  static create(
    options: CodingAgentProjectionPersistenceOptions,
  ): CodingAgentProjectionPersistenceAdapter {
    const clock = options.clock ?? SystemCodingAgentClock.create();
    const persistence = new CodingAgentProjectionPersistenceAdapter(
      createRepositories({ ...options, clock }),
      clock,
    );
    projectionRepositories.set(persistence, persistence.repositories);
    projectionClocks.set(persistence, clock);
    return persistence;
  }

  storeSession(input: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }): Promise<void> {
    return this.repositories.sessions.upsert(
      input.row,
      input.retentionDays,
      input.appliedEventIds,
    );
  }

  storeSessionBatch(
    rows: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void> {
    return this.repositories.sessions.upsertBatch(rows);
  }

  loadSessionWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null> {
    return this.repositories.sessions.tryFindBySessionIdWithApplied(input);
  }

  appendTraceSessions(
    records: CodingAgentTraceSessionRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.traceSessions.ensure(records, retentionDays);
  }

  appendMetricSeries(
    records: CodingAgentSessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.metricSeries.ensure(records, retentionDays);
  }

  appendSessionEvents(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    return this.repositories.sessionEvents.ensure(records, retentionDays);
  }
}

export type CodingAgentRuntimeOptions = {
  projections: CodingAgentProjectionPersistence;
  github: GithubService;
  projects: ProjectService;
  billing: CodingAgentBillingPolicyPort;
};

export type CodingAgentProjectionPersistenceOptions = {
  clickHouse: CodingAgentClickHousePort | null;
  retention: {
    defaultTraceRetentionDays: number;
  };
  readMetrics?: CodingAgentReadMetricsPort;
  clock?: CodingAgentClockPort;
};

/** Builds the one Coding Agent service and its projection persistence once. */
export class CodingAgentRuntime {
  readonly service: CodingAgentService;
  readonly projections: CodingAgentProjectionPersistence;

  static create(options: CodingAgentRuntimeOptions): CodingAgentRuntime {
    const repositories = projectionRepositories.get(options.projections);
    const clock = projectionClocks.get(options.projections);
    if (repositories === undefined || clock === undefined) {
      throw new Error("CodingAgentProjectionPersistence must be package-created");
    }
    const service = CodingAgentFeatureService.create({
      ...repositories,
      github: options.github,
      projects: options.projects,
      billing: options.billing,
      clock,
    });
    return new CodingAgentRuntime(service, options.projections);
  }

  private constructor(
    service: CodingAgentService,
    projections: CodingAgentProjectionPersistence,
  ) {
    this.service = service;
    this.projections = projections;
  }
}

function createRepositories(
  options: CodingAgentProjectionPersistenceOptions & { clock: CodingAgentClockPort },
): CodingAgentRepositories {
  if (options.clickHouse === null) {
    return {
      sessions: new NullCodingAgentSessionRepository(),
      traceSessions: new NullCodingAgentTraceSessionRepository(),
      metricSeries: new NullSessionMetricSeriesRepository(),
      sessionEvents: new NullCodingAgentSessionEventRepository(),
    };
  }
  const metrics = options.readMetrics ?? NoopCodingAgentReadMetricsPort.create();
  return {
    sessions: new CodingAgentSessionClickHouseRepository(
      options.clickHouse,
      options.retention.defaultTraceRetentionDays,
      metrics,
      options.clock,
    ),
    traceSessions: new CodingAgentTraceSessionClickHouseRepository(
      options.clickHouse,
      options.retention.defaultTraceRetentionDays,
    ),
    metricSeries: new SessionMetricSeriesClickHouseRepository(
      options.clickHouse,
      options.retention.defaultTraceRetentionDays,
    ),
    sessionEvents: new CodingAgentSessionEventsClickHouseRepository(
      options.clickHouse,
      options.retention.defaultTraceRetentionDays,
    ),
  };
}
