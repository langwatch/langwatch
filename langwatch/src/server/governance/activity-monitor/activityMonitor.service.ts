/**
 * ActivityMonitorService — read-side queries powering the /governance
 * admin dashboard.
 *
 * Architecture state (rchaves + master_orchestrator directive 2026-04-27):
 * the unified-trace branch correction is in flight. The previous
 * implementation queried a parallel `gateway_activity_events` CH table
 * which is being torn down. This commit (the mechanical-delete step)
 * keeps the tRPC contract stable but stubs the spend/users/event
 * queries to empty. The next commits in the rip-out wire each query
 * against `trace_summaries` + `recorded_spans` + `log_records` with
 * the `langwatch.origin.kind = "ingestion_source"` filter (governance
 * fold projection lands in commit 3).
 *
 * The anomaly-rollup query (`openAnomalyCount` + `anomalyBreakdown`)
 * stays live — it reads from `prisma.anomalyAlert` which is unaffected
 * by the storage migration.
 */
import type { PrismaClient } from "@prisma/client";

export interface SummaryResult {
  spentThisWindowUsd: number;
  windowOverPreviousPct: number;
  activeUsersThisWindow: number;
  newUsersThisWindow: number;
  openAnomalyCount: number;
  anomalyBreakdown: { critical: number; warning: number; info: number };
}

export interface SpendByUserRow {
  actor: string;
  spendUsd: number;
  requests: number;
  lastActivityIso: string;
  trendVsPreviousPct: number;
  mostUsedTarget: string | null;
}

export interface IngestionSourceHealthRow {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  lastEventIso: string | null;
  eventsLast24h: number;
}

export interface ActivityEventDetailRow {
  eventId: string;
  eventType: string;
  actor: string;
  action: string;
  target: string;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  eventTimestampIso: string;
  ingestedAtIso: string;
  rawPayload: string;
}

export interface SourceHealthMetrics {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}

const EMPTY_SUMMARY: SummaryResult = {
  spentThisWindowUsd: 0,
  windowOverPreviousPct: 0,
  activeUsersThisWindow: 0,
  newUsersThisWindow: 0,
  openAnomalyCount: 0,
  anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
};

export class ActivityMonitorService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ActivityMonitorService {
    return new ActivityMonitorService(prisma);
  }

  /**
   * Summary cards: spend / users / anomaly counts.
   *
   * Stubbed to empty pending the unified-trace cutover. Anomaly counts
   * still resolve from `prisma.anomalyAlert` — unaffected by the CH
   * storage migration.
   */
  async summary(input: {
    organizationId: string;
    windowDays: number;
  }): Promise<SummaryResult> {
    const anomalyBreakdown = await this.openAnomalyBreakdown(
      input.organizationId,
    );
    const openAnomalyCount =
      anomalyBreakdown.critical + anomalyBreakdown.warning + anomalyBreakdown.info;
    return {
      ...EMPTY_SUMMARY,
      openAnomalyCount,
      anomalyBreakdown,
    };
  }

  private async openAnomalyBreakdown(
    organizationId: string,
  ): Promise<{ critical: number; warning: number; info: number }> {
    const grouped = await this.prisma.anomalyAlert.groupBy({
      by: ["severity"],
      where: { organizationId, state: "open" },
      _count: { _all: true },
    });
    const breakdown = { critical: 0, warning: 0, info: 0 };
    for (const row of grouped) {
      const sev = row.severity as keyof typeof breakdown;
      if (sev in breakdown) breakdown[sev] = row._count._all;
    }
    return breakdown;
  }

  async spendByUser(_input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
  }): Promise<SpendByUserRow[]> {
    return [];
  }

  /**
   * Per-source health: status + last-event from PG. Volume rollups
   * (events24h) come back online once the unified-trace queries land
   * — for now, return 0 so the dashboard renders the source row but
   * doesn't lie about traffic.
   */
  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const sources = await this.prisma.ingestionSource.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      sourceType: src.sourceType,
      status: src.status,
      lastEventIso: src.lastEventAt?.toISOString() ?? null,
      eventsLast24h: 0,
    }));
  }

  async eventsForSource(_input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    return [];
  }

  async sourceHealthMetrics(_input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    return {
      events24h: 0,
      events7d: 0,
      events30d: 0,
      lastSuccessIso: null,
    };
  }
}
