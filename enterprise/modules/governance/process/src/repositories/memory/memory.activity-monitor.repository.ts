// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  ActivityEventDetailRow,
  ActivityMonitorSummary,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";

import type { ActivityMonitorRepository } from "../../app/governance.members.ts";

type SourceDataCoverage = Awaited<ReturnType<ActivityMonitorRepository["sourceDataCoverage"]>>;

/** One organization's dashboard, as the ClickHouse and Prisma reads would answer it. */
export interface ActivityMonitorSnapshot {
  summary: ActivityMonitorSummary;
  spendByUser: SpendByUserRow[];
  spendByTeam: SpendByTeamRow[];
  spendByDepartment: SpendByDepartmentRow[];
  spendOverTime: SpendOverTimeResult;
  recentAnomalies: RecentAnomalyRow[];
  ingestionSourcesHealth: IngestionSourceHealthRow[];
  eventsBySource: Record<string, ActivityEventDetailRow[]>;
  metricsBySource: Record<string, SourceHealthMetrics>;
  coverageBySource: Record<string, SourceDataCoverage>;
}

const EMPTY_SNAPSHOT: ActivityMonitorSnapshot = {
  summary: {
    spentThisWindowUsd: 0,
    windowOverPreviousPct: 0,
    hasPriorBaseline: false,
    activeUsersThisWindow: 0,
    newUsersThisWindow: 0,
    openAnomalyCount: 0,
    anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
  },
  spendByUser: [],
  spendByTeam: [],
  spendByDepartment: [],
  spendOverTime: { buckets: [] },
  recentAnomalies: [],
  ingestionSourcesHealth: [],
  eventsBySource: {},
  metricsBySource: {},
  coverageBySource: {},
};

/**
 * The activity-monitor twin: an organization with no activity reads as the empty
 * dashboard; a test seeds a snapshot through {@link record} and reads it back paged
 * and limited the way `PrismaActivityMonitorRepository` pages its rows.
 */
export class MemoryActivityMonitorRepository implements ActivityMonitorRepository {
  private readonly snapshots = new Map<string, Partial<ActivityMonitorSnapshot>>();

  static create(): MemoryActivityMonitorRepository {
    return new MemoryActivityMonitorRepository();
  }

  /** Test seam: what one organization's dashboard answers. */
  record(organizationId: string, snapshot: Partial<ActivityMonitorSnapshot>): void {
    this.snapshots.set(organizationId, { ...this.snapshots.get(organizationId), ...snapshot });
  }

  private of(organizationId: string): ActivityMonitorSnapshot {
    return { ...EMPTY_SNAPSHOT, ...this.snapshots.get(organizationId) };
  }

  async sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceDataCoverage> {
    return (
      this.of(input.organizationId).coverageBySource[input.sourceId] ?? {
        health: "healthy",
        consecutiveFailures: 0,
        lastSuccessfulPullIso: null,
        days: [],
      }
    );
  }

  async summary(input: { organizationId: string }): Promise<ActivityMonitorSummary> {
    return this.of(input.organizationId).summary;
  }

  async spendByUser(input: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<SpendByUserRow[]> {
    return page(this.of(input.organizationId).spendByUser, input);
  }

  async spendByTeam(input: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<SpendByTeamRow[]> {
    return page(this.of(input.organizationId).spendByTeam, input);
  }

  async spendByDepartment(input: { organizationId: string }): Promise<SpendByDepartmentRow[]> {
    return this.of(input.organizationId).spendByDepartment;
  }

  async spendOverTime(input: { organizationId: string }): Promise<SpendOverTimeResult> {
    return this.of(input.organizationId).spendOverTime;
  }

  async recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    return page(this.of(input.organizationId).recentAnomalies, input);
  }

  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    return this.of(input.organizationId).ingestionSourcesHealth;
  }

  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    const events = this.of(input.organizationId).eventsBySource[input.sourceId] ?? [];
    const before = input.beforeIso;
    return page(before ? events.filter((e) => e.eventTimestampIso < before) : events, input);
  }

  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    return (
      this.of(input.organizationId).metricsBySource[input.sourceId] ?? {
        events24h: 0,
        events7d: 0,
        events30d: 0,
        lastSuccessIso: null,
      }
    );
  }
}

function page<Row>(rows: Row[], input: { limit?: number; offset?: number }): Row[] {
  const offset = input.offset ?? 0;
  return rows.slice(offset, input.limit === undefined ? undefined : offset + input.limit);
}
