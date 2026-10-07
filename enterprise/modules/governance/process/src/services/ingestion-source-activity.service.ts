import {
  type ActivityEventDetailRow,
  type ActivityMonitorPagedWindowQuery,
  type ActivityMonitorSummary,
  type ActivityMonitorWindowQuery,
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  type IngestionSourceHealthRow,
  type RecentAnomalyRow,
  type SourceHealthMetrics,
  type SpendByDepartmentRow,
  type SpendByTeamRow,
  type SpendByUserRow,
  type SpendOverTimeGroupBy,
  type SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";
import type { TraceApi, TraceDailySpendGroup } from "@langwatch/trace-contract";

import type { ActivityMonitorRepository } from "../repositories/activity-monitor.repository.ts";
import {
  emptyDenseBuckets,
  isoOf,
  pctChange,
  rollDepartmentSpend,
  rollSpendOverTime,
  rollTeamSpend,
  type SourceTeam,
  startOfUtcDay,
} from "../rules/activity-monitor-spend.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only governance-ingested traces count towards the monitor's governance-project reads. */
const GOVERNANCE_ORIGIN = [
  { key: GOVERNANCE_ATTR.ORIGIN_KIND, value: GOVERNANCE_ORIGIN_KIND_VALUE },
] as const;

/** The trace reads the activity monitor answers its spend and event views from. */
export type ActivityMonitorTraces = Pick<
  TraceApi,
  | "getAttributedSpendComparison"
  | "findAttributedSpendByValue"
  | "findAttributedSpendComparisonByValue"
  | "findSpendByProjectAndValue"
  | "findDailyAttributedSpend"
  | "countAttributedTracesByValue"
  | "findAttributedTracesBefore"
  | "getAttributedTraceRecency"
>;

const EMPTY_SUMMARY: ActivityMonitorSummary = {
  spentThisWindowUsd: 0,
  windowOverPreviousPct: 0,
  hasPriorBaseline: false,
  activeUsersThisWindow: 0,
  newUsersThisWindow: 0,
  openAnomalyCount: 0,
  anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
};

const SPEND_OVER_TIME_GROUP: Record<SpendOverTimeGroupBy, TraceDailySpendGroup> = {
  team: { kind: "attribute", key: GOVERNANCE_ATTR.INGESTION_SOURCE_ID },
  user: { kind: "attribute", key: GOVERNANCE_ATTR.USER_ID },
  model: { kind: "firstModel" },
};

/**
 * The activity monitor: trace spend and pushed events through TraceApi, scoped to the
 * organisation's hidden governance project; pulled and logged events, sources, teams and
 * departments from its own repository. No governance project short-circuits to empty.
 */
export class ActivityMonitorService {
  private constructor(
    private readonly repository: ActivityMonitorRepository,
    private readonly projects: Pick<ProjectApi, "findInternal">,
    private readonly traces: ActivityMonitorTraces,
  ) {}

  static create({
    repository,
    projects,
    traces,
  }: {
    repository: ActivityMonitorRepository;
    projects: Pick<ProjectApi, "findInternal">;
    traces: ActivityMonitorTraces;
  }): ActivityMonitorService {
    return new ActivityMonitorService(repository, projects, traces);
  }

  private async findGovProjectId(organizationId: string): Promise<string | null> {
    const project = await this.projects.findInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    return project?.id ?? null;
  }

  private async teamsBySource({
    organizationId,
    sourceIds,
  }: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<Map<string, SourceTeam>> {
    const rows = await this.repository.findSourceTeams({
      organizationId,
      sourceIds: [...new Set(sourceIds.filter((id) => id !== ""))],
    });
    return new Map(rows.map((row) => [row.sourceId, row.team] as const));
  }

  sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): ReturnType<ActivityMonitorRepository["sourceDataCoverage"]> {
    return this.repository.sourceDataCoverage(input);
  }

  async summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary> {
    const anomalyBreakdown = await this.repository.getOpenAnomalyBreakdown({
      organizationId: input.organizationId,
    });
    const openAnomalyCount =
      anomalyBreakdown.critical + anomalyBreakdown.warning + anomalyBreakdown.info;
    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return { ...EMPTY_SUMMARY, openAnomalyCount, anomalyBreakdown };

    const now = nowInstant().epochMilliseconds;
    const windowMs = input.windowDays * DAY_MS;
    const spend = await this.traces.getAttributedSpendComparison({
      projectId: govProjectId,
      matches: GOVERNANCE_ORIGIN,
      actorKey: GOVERNANCE_ATTR.USER_ID,
      previousStartMs: now - 2 * windowMs,
      currentStartMs: now - windowMs,
      endMs: now,
    });
    const thisSpend = spend.currentSpendUsd;
    const prevSpend = spend.previousSpendUsd;
    return {
      spentThisWindowUsd: thisSpend,
      windowOverPreviousPct: pctChange({ current: thisSpend, previous: prevSpend }),
      hasPriorBaseline: prevSpend > 0,
      activeUsersThisWindow: spend.currentActors,
      // Without a per-user first-seen fold, every active user counts as new only when prev=0.
      newUsersThisWindow: prevSpend === 0 ? spend.currentActors : 0,
      openAnomalyCount,
      anomalyBreakdown,
    };
  }

  async spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return [];
    const now = nowInstant().epochMilliseconds;
    const rows = await this.traces.findAttributedSpendByValue({
      projectId: govProjectId,
      matches: GOVERNANCE_ORIGIN,
      valueKey: GOVERNANCE_ATTR.USER_ID,
      window: { startMs: now - input.windowDays * DAY_MS, endMs: now },
      sortBy: input.sortBy ?? "spend",
      sortDirection: input.sortDir === "asc" ? "asc" : "desc",
      limit: input.limit ?? 50,
      offset: Math.max(0, input.offset ?? 0),
    });
    return rows.map((row) => ({
      actor: row.value,
      spendUsd: row.spentUsd,
      requests: row.requests,
      lastActivityIso: isoOf(row.lastOccurredAtMs),
      trendVsPreviousPct: 0,
      hasPriorBaseline: false,
      mostUsedTarget: row.firstModel || null,
    }));
  }

  /**
   * Spend per source split at the window start, rolled into the sources' teams (Org-wide when
   * unowned), then sorted and paged after the Postgres join.
   * Spec: specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
   */
  async spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return [];
    const now = nowInstant().epochMilliseconds;
    const windowMs = input.windowDays * DAY_MS;
    const rows = await this.traces.findAttributedSpendComparisonByValue({
      projectId: govProjectId,
      matches: GOVERNANCE_ORIGIN,
      valueKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
      previousStartMs: now - 2 * windowMs,
      currentStartMs: now - windowMs,
      endMs: now,
    });
    if (rows.length === 0) return [];
    const teamBySource = await this.teamsBySource({
      organizationId: input.organizationId,
      sourceIds: rows.map((row) => row.value),
    });
    return rollTeamSpend({
      rows,
      teamBySource,
      sortBy: input.sortBy ?? "spend",
      sortDir: input.sortDir ?? "desc",
      limit: input.limit ?? 50,
      offset: Math.max(0, input.offset ?? 0),
    });
  }

  /**
   * Spend by department across every live project of the organisation, not only the
   * governance project; a trace's department resolves principal user, then team, then project.
   * Spec: specs/ai-gateway/governance/departments.feature (the @birds-eye scenarios)
   */
  async spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]> {
    const directory = await this.repository.getDepartmentDirectory({
      organizationId: input.organizationId,
    });
    if (directory.projectDepartmentById.size === 0) return [];
    const now = nowInstant().epochMilliseconds;
    const rows = await this.traces.findSpendByProjectAndValue({
      projectIds: [...directory.projectDepartmentById.keys()],
      valueKey: GOVERNANCE_ATTR.USER_ID,
      window: { startMs: now - input.windowDays * DAY_MS, endMs: now },
    });
    return rollDepartmentSpend({ rows, directory });
  }

  /**
   * Daily spend by team, user or first model as a dense series (every day of the window, empty
   * days as `points: []`), as the stacked-area chart needs.
   * Spec: specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
   */
  async spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    const windowDays = Math.max(1, Math.floor(input.windowDays));
    const now = nowInstant().epochMilliseconds;
    const windowStartMs = startOfUtcDay(now) - (windowDays - 1) * DAY_MS;

    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return { buckets: emptyDenseBuckets({ windowStartMs, windowDays }) };

    const rows = await this.traces.findDailyAttributedSpend({
      projectId: govProjectId,
      matches: GOVERNANCE_ORIGIN,
      groupBy: SPEND_OVER_TIME_GROUP[input.groupBy],
      window: { startMs: windowStartMs, endMs: now },
    });
    const teamBySource =
      input.groupBy === "team"
        ? await this.teamsBySource({
            organizationId: input.organizationId,
            sourceIds: rows.map((row) => row.value ?? ""),
          })
        : undefined;
    return { buckets: rollSpendOverTime({ rows, windowStartMs, windowDays, teamBySource }) };
  }

  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]> {
    return this.repository.recentAnomalies(input);
  }

  /** Each source's events in the last 24h: pushed traces, pushed logs and pulled rows summed. */
  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const sources = await this.repository.findActiveSources(input);
    if (sources.length === 0) return [];

    const govProjectId = await this.findGovProjectId(input.organizationId);
    const eventsBySource = new Map<string, number>();
    if (govProjectId) {
      const sourceIds = sources.map((s) => s.id);
      const sinceMs = nowInstant().epochMilliseconds - DAY_MS;
      const [traced, untraced] = await Promise.all([
        this.traces.countAttributedTracesByValue({
          projectId: govProjectId,
          matches: GOVERNANCE_ORIGIN,
          valueKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
          values: sourceIds,
          sinceMs,
        }),
        this.repository.countLoggedAndPulledEventsBySource({
          organizationId: input.organizationId,
          tenantId: govProjectId,
          sourceIds,
          sinceMs,
        }),
      ]);
      for (const row of traced) {
        eventsBySource.set(row.value, (eventsBySource.get(row.value) ?? 0) + row.count);
      }
      for (const row of untraced) {
        eventsBySource.set(row.sourceId, (eventsBySource.get(row.sourceId) ?? 0) + row.count);
      }
    }
    return sources.map((src) => ({ ...src, eventsLast24h: eventsBySource.get(src.id) ?? 0 }));
  }

  /** Pushed traces and pulled rows merged newest first, deduped by event id, then limited. */
  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const limit = input.limit ?? 50;
    const beforeMs = input.beforeIso ? toEpochMs(input.beforeIso) : nowInstant().epochMilliseconds;
    const [pushed, pulledEvents] = await Promise.all([
      this.traces.findAttributedTracesBefore({
        projectId: govProjectId,
        matches: [
          ...GOVERNANCE_ORIGIN,
          { key: GOVERNANCE_ATTR.INGESTION_SOURCE_ID, value: input.sourceId },
        ],
        attributeKeys: [GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE, GOVERNANCE_ATTR.USER_ID],
        beforeMs,
        limit,
      }),
      this.repository.findPulledEventsForSource({
        organizationId: input.organizationId,
        tenantId: govProjectId,
        sourceId: input.sourceId,
        beforeMs,
        limit,
      }),
    ]);
    const pushedEvents: ActivityEventDetailRow[] = pushed.map((trace) => ({
      eventId: trace.traceId,
      eventType: trace.attributes[GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE] ?? "",
      actor: trace.attributes[GOVERNANCE_ATTR.USER_ID] ?? "",
      action: "trace.recorded",
      target: trace.firstModel,
      costUsd: String(trace.costUsd),
      tokensInput: trace.promptTokens,
      tokensOutput: trace.completionTokens,
      eventTimestampIso: isoOf(trace.occurredAtMs),
      ingestedAtIso: isoOf(trace.createdAtMs),
      rawPayload: "",
    }));

    const seen = new Set<string>();
    return [...pushedEvents, ...pulledEvents]
      .toSorted(
        (a, b) =>
          toEpochMs(b.eventTimestampIso) - toEpochMs(a.eventTimestampIso) ||
          b.eventId.localeCompare(a.eventId),
      )
      .filter((event) => {
        if (seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .slice(0, limit);
  }

  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    const govProjectId = await this.findGovProjectId(input.organizationId);
    if (!govProjectId) return { events24h: 0, events7d: 0, events30d: 0, lastSuccessIso: null };

    const now = nowInstant().epochMilliseconds;
    const since24h = now - DAY_MS;
    const since7d = now - 7 * DAY_MS;
    const since30d = now - 30 * DAY_MS;
    const [recency, untraced] = await Promise.all([
      this.traces.getAttributedTraceRecency({
        projectId: govProjectId,
        matches: [
          ...GOVERNANCE_ORIGIN,
          { key: GOVERNANCE_ATTR.INGESTION_SOURCE_ID, value: input.sourceId },
        ],
        countSinceMs: [since24h, since7d, since30d],
      }),
      this.repository.findLoggedAndPulledEventWindows({
        organizationId: input.organizationId,
        tenantId: govProjectId,
        sourceId: input.sourceId,
        since24h,
        since7d,
        since30d,
      }),
    ]);
    const windows = [
      {
        c24: recency.counts[0] ?? 0,
        c7: recency.counts[1] ?? 0,
        c30: recency.counts[2] ?? 0,
        lastMs: recency.lastOccurredAtMs,
      },
      ...untraced,
    ];
    const total = (pick: (w: (typeof windows)[number]) => number) =>
      windows.reduce((sum, w) => sum + pick(w), 0);
    const lastMs = Math.max(0, ...windows.map((w) => w.lastMs));
    return {
      events24h: total((w) => w.c24),
      events7d: total((w) => w.c7),
      events30d: total((w) => w.c30),
      lastSuccessIso: lastMs > 0 ? isoOf(lastMs) : null,
    };
  }
}
