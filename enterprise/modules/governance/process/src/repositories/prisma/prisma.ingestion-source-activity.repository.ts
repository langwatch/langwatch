// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PrismaActivityMonitorRepository - the activity monitor's own rows: sources, anomalies and
 * departments in Postgres, and a source's pulled OCSF events and pushed log records in
 * ClickHouse. Trace spend is trace's, read through TraceApi by ActivityMonitorService.
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import {
  type ActivityEventDetailRow,
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  type IngestionSourceHealthRow,
  type RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { DepartmentDirectory, SourceTeam } from "../../rules/activity-monitor-spend.rules.ts";
import type {
  ActivityMonitorRepository,
  AnomalyBreakdown,
  SourceEventWindows,
} from "../activity-monitor.repository.ts";
import type {
  GovernanceClickHouseClient,
  GovernanceClickHouseResolver,
} from "../clickhouse/clickhouse.governance-clickhouse.repositories.ts";

const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

const ZERO_PULLED_USAGE = {
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
};

/**
 * Usage on a stored pulled OCSF row's `metadata.extension`, parsed because an adapter's `extra`
 * can land anything there: each field falls back to 0 alone. Not `.nonnegative()`: a credit
 * line is a reported figure on the audit record and must show, not read as 0.
 */
const pulledUsageExtensionSchema = z
  .object({
    cost_usd: z
      .union([z.string(), z.number()])
      .transform((v) => {
        const s = String(v).trim();
        return s !== "" && Number.isFinite(Number(s)) ? s : "0";
      })
      .catch("0"),
    tokens_input: z.coerce.number().finite().catch(0),
    tokens_output: z.coerce.number().finite().catch(0),
  })
  .catch(ZERO_PULLED_USAGE);

/** One `(sourceId, count)` pair from either per-source count query. */
type SourceEventCountRow = { sourceId: string; c: string };

/** The 24h/7d/30d counters plus newest timestamp one table contributes. */
type WindowCountRow = {
  c24: number | string;
  c7: number | string;
  c30: number | string;
  lastMs: string | null;
};

type WindowCountArgs = {
  ch: GovernanceClickHouseClient;
  tenantId: string;
  sourceId: string;
  since24h: number;
  since7d: number;
  since30d: number;
};

type SourceCountArgs = {
  ch: GovernanceClickHouseClient;
  tenantId: string;
  sourceIds: readonly string[];
  since: number;
};

type PulledEventRow = {
  eventId: string;
  eventType: string;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  action: string;
  target: string;
  occurredMs: string;
  createdMs: string;
  rawPayload: string;
};

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ActivityMonitorDatabase = Pick<
  PrismaClient,
  "anomalyAlert" | "department" | "ingestionSource" | "organizationUser" | "project"
>;

export class PrismaActivityMonitorRepository implements ActivityMonitorRepository {
  private constructor(
    private readonly prisma: ActivityMonitorDatabase,
    private readonly clickhouse: GovernanceClickHouseResolver,
  ) {}

  static create(options: {
    prisma: ActivityMonitorDatabase;
    clickhouse: GovernanceClickHouseResolver;
  }): PrismaActivityMonitorRepository {
    return new PrismaActivityMonitorRepository(options.prisma, options.clickhouse);
  }

  async sourceDataCoverage(input: {
    organizationId: string;
    sourceId: string;
    windowDays: number;
  }): Promise<{
    health: "healthy" | "unhealthy";
    consecutiveFailures: number;
    lastSuccessfulPullIso: string | null;
    days: { dayStartIso: string; covered: boolean }[];
  }> {
    const source = await this.prisma.ingestionSource.findFirstOrThrow({
      where: { id: input.sourceId, organizationId: input.organizationId },
      select: { errorCount: true, lastSuccessAt: true },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = Array.from({ length: input.windowDays }, (_, index) => {
      const day = new Date(today.getTime() - (input.windowDays - index - 1) * 86_400_000);
      return {
        dayStartIso: day.toISOString(),
        covered: source.lastSuccessAt !== null && day.getTime() <= source.lastSuccessAt.getTime(),
      };
    });
    return {
      health: source.errorCount >= 3 ? "unhealthy" : "healthy",
      consecutiveFailures: source.errorCount,
      lastSuccessfulPullIso: source.lastSuccessAt?.toISOString() ?? null,
      days,
    };
  }

  async getOpenAnomalyBreakdown(input: { organizationId: string }): Promise<AnomalyBreakdown> {
    const grouped = await this.prisma.anomalyAlert.groupBy({
      by: ["severity"],
      where: { organizationId: input.organizationId, state: "open" },
      _count: { _all: true },
    });
    const breakdown = { critical: 0, warning: 0, info: 0 };
    for (const row of grouped) {
      const sev = row.severity as keyof typeof breakdown;
      if (sev in breakdown) breakdown[sev] = row._count._all;
    }
    return breakdown;
  }

  /**
   * A member's own department, and separately the first non-personal team department they
   * inherit, keyed by email (the `langwatch.user_id` attribute). Archived departments are
   * absent from `activeDepartmentNames`, so they roll up as Unassigned without a backfill.
   */
  async getDepartmentDirectory(input: { organizationId: string }): Promise<DepartmentDirectory> {
    const { organizationId } = input;
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true, departmentId: true },
    });
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        departmentId: true,
        user: {
          select: {
            email: true,
            teamMemberships: {
              where: {
                team: { organizationId, isPersonal: false, departmentId: { not: null } },
              },
              select: { team: { select: { departmentId: true } } },
            },
          },
        },
      },
    });
    const departments = await this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
    });

    const userDepartmentByEmail = new Map<string, string | null>();
    const userTeamDepartmentByEmail = new Map<string, string | null>();
    for (const m of members) {
      const email = m.user.email;
      if (!email) continue;
      userDepartmentByEmail.set(email, m.departmentId);
      const inherited = m.user.teamMemberships.find((tm) => tm.team.departmentId)?.team
        .departmentId;
      userTeamDepartmentByEmail.set(email, inherited ?? null);
    }
    return {
      projectDepartmentById: new Map(projects.map((p) => [p.id, p.departmentId] as const)),
      userDepartmentByEmail,
      userTeamDepartmentByEmail,
      activeDepartmentNames: new Map(departments.map((d) => [d.id, d.name] as const)),
    };
  }

  async findSourceTeams(input: {
    organizationId: string;
    sourceIds: readonly string[];
  }): Promise<{ sourceId: string; team: SourceTeam }[]> {
    if (input.sourceIds.length === 0) return [];
    const sources = await this.prisma.ingestionSource.findMany({
      where: { id: { in: [...input.sourceIds] }, organizationId: input.organizationId },
      select: { id: true, team: { select: { id: true, name: true } } },
    });
    return sources.map((s) => ({ sourceId: s.id, team: s.team ?? null }));
  }

  async findActiveSources(input: {
    organizationId: string;
  }): Promise<Omit<IngestionSourceHealthRow, "eventsLast24h">[]> {
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
    }));
  }

  async countLoggedAndPulledEventsBySource(input: {
    organizationId: string;
    tenantId: string;
    sourceIds: readonly string[];
    sinceMs: number;
  }): Promise<{ sourceId: string; count: number }[]> {
    const args: SourceCountArgs = {
      ch: await this.clickhouse.getClient(input.organizationId),
      tenantId: input.tenantId,
      sourceIds: input.sourceIds,
      since: input.sinceMs,
    };
    const counts = await Promise.all([
      PrismaActivityMonitorRepository.countLoggedEventsBySource(args),
      PrismaActivityMonitorRepository.countPulledEventsBySource(args),
    ]);
    return counts.flat().map((row) => ({ sourceId: row.sourceId, count: Number(row.c) }));
  }

  private static async countLoggedEventsBySource(
    args: SourceCountArgs,
  ): Promise<SourceEventCountRow[]> {
    const result = await args.ch.query({
      query: `
        SELECT lr.Attributes[{sourceKey:String}] AS sourceId, toString(count()) AS c
        FROM stored_log_records lr
        WHERE lr.TenantId = {tenantId:String}
          AND lr.TimeUnixMs >= fromUnixTimestamp64Milli({since:UInt64})
          AND lr.Attributes[{originKey:String}] = {originValue:String}
          AND lr.Attributes[{sourceKey:String}] IN ({sourceIds:Array(String)})
        GROUP BY sourceId
      `,
      query_params: {
        tenantId: args.tenantId,
        since: args.since,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceIds: args.sourceIds,
      },
      format: "JSONEachRow",
    });
    return (await result.json()) as SourceEventCountRow[];
  }

  private static async countPulledEventsBySource(
    args: SourceCountArgs,
  ): Promise<SourceEventCountRow[]> {
    const result = await args.ch.query({
      query: `
        SELECT SourceId AS sourceId, toString(count()) AS c
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND EventTime >= fromUnixTimestamp64Milli({since:UInt64})
          AND SourceId IN ({sourceIds:Array(String)})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND EventTime >= fromUnixTimestamp64Milli({since:UInt64})
              AND SourceId IN ({sourceIds:Array(String)})
            GROUP BY TenantId, EventId
          )
        GROUP BY sourceId
      `,
      query_params: {
        tenantId: args.tenantId,
        since: args.since,
        sourceIds: args.sourceIds,
      },
      format: "JSONEachRow",
    });
    return (await result.json()) as SourceEventCountRow[];
  }

  /** Rows a puller wrote to `governance_ocsf_events` under the synthetic `pull:` trace id. */
  async findPulledEventsForSource(input: {
    organizationId: string;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<ActivityEventDetailRow[]> {
    const ch = await this.clickhouse.getClient(input.organizationId);
    const result = await ch.query({
      query: `
        SELECT
          EventId AS eventId,
          SourceType AS eventType,
          ActorUserId AS actorUserId,
          ActorEmail AS actorEmail,
          ActorEnduserId AS actorEnduserId,
          ActionName AS action,
          TargetName AS target,
          toString(toUnixTimestamp64Milli(EventTime)) AS occurredMs,
          toString(toUnixTimestamp64Milli(CreatedAt)) AS createdMs,
          RawOcsfJson AS rawPayload
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND SourceId = {sourceId:String}
          AND EventTime < fromUnixTimestamp64Milli({beforeMs:UInt64})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND SourceId = {sourceId:String}
              AND EventTime < fromUnixTimestamp64Milli({beforeMs:UInt64})
            GROUP BY TenantId, EventId
          )
        ORDER BY EventTime DESC, EventId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        beforeMs: input.beforeMs,
        limit: input.limit,
      },
      format: "JSONEachRow",
    });
    return ((await result.json()) as PulledEventRow[]).map((row) =>
      PrismaActivityMonitorRepository.toPulledEvent(row),
    );
  }

  async findLoggedAndPulledEventWindows(input: {
    organizationId: string;
    tenantId: string;
    sourceId: string;
    since24h: number;
    since7d: number;
    since30d: number;
  }): Promise<SourceEventWindows[]> {
    const args: WindowCountArgs = {
      ch: await this.clickhouse.getClient(input.organizationId),
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      since24h: input.since24h,
      since7d: input.since7d,
      since30d: input.since30d,
    };
    const windows = await Promise.all([
      PrismaActivityMonitorRepository.loggedEventWindowCounts(args),
      PrismaActivityMonitorRepository.pulledEventWindowCounts(args),
    ]);
    return windows
      .filter((row): row is WindowCountRow => row !== undefined)
      .map((row) => ({
        c24: Number(row.c24 ?? 0),
        c7: Number(row.c7 ?? 0),
        c30: Number(row.c30 ?? 0),
        lastMs: row.lastMs ? Number(row.lastMs) : 0,
      }));
  }

  private static async loggedEventWindowCounts(
    args: WindowCountArgs,
  ): Promise<WindowCountRow | undefined> {
    const result = await args.ch.query({
      query: `
        SELECT
          countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
          countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
          count() AS c30,
          (SELECT toString(toUnixTimestamp64Milli(max(TimeUnixMs)))
           FROM stored_log_records
           WHERE TenantId = {tenantId:String} AND Attributes[{originKey:String}] = {originValue:String} AND Attributes[{sourceKey:String}] = {sourceId:String}) AS lastMs
        FROM stored_log_records lr
        WHERE lr.TenantId = {tenantId:String}
          AND lr.TimeUnixMs >= fromUnixTimestamp64Milli({since30d:UInt64})
          AND lr.Attributes[{originKey:String}] = {originValue:String}
          AND lr.Attributes[{sourceKey:String}] = {sourceId:String}
      `,
      query_params: {
        tenantId: args.tenantId,
        since24h: args.since24h,
        since7d: args.since7d,
        since30d: args.since30d,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceId: args.sourceId,
      },
      format: "JSONEachRow",
    });
    return ((await result.json()) as WindowCountRow[])[0];
  }

  private static async pulledEventWindowCounts(
    args: WindowCountArgs,
  ): Promise<WindowCountRow | undefined> {
    const result = await args.ch.query({
      query: `
        SELECT
          countIf(EventTime >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
          countIf(EventTime >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
          count() AS c30,
          (SELECT toString(toUnixTimestamp64Milli(max(EventTime)))
           FROM governance_ocsf_events
           WHERE TenantId = {tenantId:String} AND startsWith(TraceId, 'pull:') AND SourceId = {sourceId:String}) AS lastMs
        FROM governance_ocsf_events
        WHERE TenantId = {tenantId:String}
          AND startsWith(TraceId, 'pull:')
          AND SourceId = {sourceId:String}
          AND EventTime >= fromUnixTimestamp64Milli({since30d:UInt64})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}
              AND startsWith(TraceId, 'pull:')
              AND SourceId = {sourceId:String}
              AND EventTime >= fromUnixTimestamp64Milli({since30d:UInt64})
            GROUP BY TenantId, EventId
          )
      `,
      query_params: {
        tenantId: args.tenantId,
        since24h: args.since24h,
        since7d: args.since7d,
        since30d: args.since30d,
        sourceId: args.sourceId,
      },
      format: "JSONEachRow",
    });
    return ((await result.json()) as WindowCountRow[])[0];
  }

  /** Alerts newest first; an organisation with none reads `[]`. */
  async recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    const limit = input.limit ?? 50;
    const rows = await this.prisma.anomalyAlert.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { detectedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      ruleType: row.ruleType,
      severity: row.severity as "critical" | "warning" | "info",
      triggerWindowStartIso: row.triggerWindowStart.toISOString(),
      triggerWindowEndIso: row.triggerWindowEnd.toISOString(),
      triggerSpendUsd: row.triggerSpendUsd ? Number(row.triggerSpendUsd.toString()) : null,
      triggerEventCount: row.triggerEventCount,
      detectedAtIso: row.detectedAt.toISOString(),
      state: row.state,
      currentState: row.state as "open" | "acknowledged" | "resolved",
      detail: row.detail as Record<string, unknown>,
      // Back-compat aliases for the existing /governance dashboard.
      rule: row.ruleName,
      sourceLabel: PrismaActivityMonitorRepository.extractSourceLabel(row.detail),
    }));
  }

  private static extractSourceLabel(detail: unknown): string {
    const d = (detail as Record<string, unknown>) ?? {};
    if (typeof d.sourceLabel === "string") return d.sourceLabel;
    if (typeof d.source === "string") return d.source;
    return "";
  }

  private static pulledUsageFromRawOcsf(rawPayload: string): {
    costUsd: string;
    tokensInput: number;
    tokensOutput: number;
  } {
    let extension: unknown;
    try {
      extension = (JSON.parse(rawPayload) as { metadata?: { extension?: unknown } })?.metadata
        ?.extension;
    } catch {
      extension = null;
    }
    const usage = pulledUsageExtensionSchema.parse(extension ?? {});
    return {
      costUsd: usage.cost_usd,
      tokensInput: usage.tokens_input,
      tokensOutput: usage.tokens_output,
    };
  }

  private static toPulledEvent(row: PulledEventRow): ActivityEventDetailRow {
    return {
      eventId: row.eventId,
      eventType: row.eventType ?? "",
      actor: row.actorEmail || row.actorUserId || row.actorEnduserId || "",
      action: row.action ?? "",
      target: row.target ?? "",
      ...PrismaActivityMonitorRepository.pulledUsageFromRawOcsf(row.rawPayload),
      eventTimestampIso: new Date(Number(row.occurredMs)).toISOString(),
      ingestedAtIso: new Date(Number(row.createdMs)).toISOString(),
      rawPayload: row.rawPayload,
    };
  }
}
