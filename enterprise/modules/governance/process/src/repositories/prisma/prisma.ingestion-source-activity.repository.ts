// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  type ActivityEventDetailRow,
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
  type IngestionSourceHealthRow,
  type RecentAnomalyRow,
} from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * PrismaActivityMonitorRepository - the activity monitor's own rows: sources, anomalies and
 * departments in Postgres, and a source's pulled OCSF events and pushed log records in
 * ClickHouse. Trace spend is trace's, read through TraceApi by ActivityMonitorService.
 * Spec: specs/ai-gateway/governance/folds.feature
 */
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  DepartmentDirectory,
  SourceTeam,
} from "../../features/cost/rules/activity-monitor-spend.rules.ts";
import type {
  ActivityMonitorRepository,
  AnomalyBreakdown,
  SourceEventWindows,
} from "../activity-monitor.repository.ts";
import { governanceOcsfEvents as events } from "../clickhouse/clickhouse.governance-ocsf-events.table.ts";
import { storedLogRecords as logs } from "../clickhouse/clickhouse.stored-log-records.table.ts";
import type {
  GovernanceClickHouseReadClient,
  GovernanceClickHouseReadResolver,
} from "../governance.repositories.ts";

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

/** The 24h/7d/30d counters plus newest timestamp one table contributes. */
type WindowCountRow = {
  c24: number | string;
  c7: number | string;
  c30: number | string;
  lastMs: string | null;
};

/** A pulled event is one a puller wrote under the synthetic `pull:` trace id. */
const PULLED_TRACE_PREFIX = "pull:";

type WindowCountArgs = {
  ch: GovernanceClickHouseReadClient;
  tenantId: string;
  sourceId: string;
  since24h: number;
  since7d: number;
  since30d: number;
};

type SourceCountArgs = {
  ch: GovernanceClickHouseReadClient;
  tenantId: string;
  sourceIds: readonly string[];
  since: number;
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
    private readonly clickhouse: GovernanceClickHouseReadResolver,
  ) {}

  static create(options: {
    prisma: ActivityMonitorDatabase;
    clickhouse: GovernanceClickHouseReadResolver;
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
    const today = nowInstant().toZonedDateTimeISO("UTC").startOfDay();
    const days = Array.from({ length: input.windowDays }, (_, index) => {
      const day = toDate(today.subtract({ days: input.windowDays - index - 1 }));
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
      ch: await this.clickhouse(input.tenantId),
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
  ): Promise<{ sourceId: string; c: string }[]> {
    if (args.sourceIds.length === 0) return [];
    const sourceOf = fn.mapGet(logs.Attributes, ATTR_INGESTION_SOURCE_ID);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: args.tenantId }) })
      .from(logs)
      .select({ sourceId: sourceOf, c: fn.toString(fn.count()) })
      .where(({ and, eq, gte, oneOf }) =>
        and(
          gte(logs.TimeUnixMs, args.since),
          eq(fn.mapGet(logs.Attributes, ATTR_ORIGIN_KIND), ORIGIN_KIND_VALUE),
          oneOf(sourceOf, args.sourceIds),
        ),
      )
      .groupBy(sourceOf)
      .build();
    return (await args.ch.read({ statement })).rows;
  }

  private static async countPulledEventsBySource(
    args: SourceCountArgs,
  ): Promise<{ sourceId: string; c: string }[]> {
    if (args.sourceIds.length === 0) return [];
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: args.tenantId }) })
      .from(events)
      .select({ sourceId: events.SourceId, c: fn.toString(fn.count()) })
      .where(({ and, gte, oneOf }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          gte(events.EventTime, args.since),
          oneOf(events.SourceId, args.sourceIds),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .groupBy(events.SourceId)
      .build();
    return (await args.ch.read({ statement })).rows;
  }

  /** Rows a puller wrote to `governance_ocsf_events` under the synthetic `pull:` trace id. */
  async findPulledEventsForSource(input: {
    organizationId: string;
    tenantId: string;
    sourceId: string;
    beforeMs: number;
    limit: number;
  }): Promise<ActivityEventDetailRow[]> {
    const ch = await this.clickhouse(input.tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(events)
      .select({
        eventId: events.EventId,
        eventType: events.SourceType,
        actorUserId: events.ActorUserId,
        actorEmail: events.ActorEmail,
        actorEnduserId: events.ActorEnduserId,
        action: events.ActionName,
        target: events.TargetName,
        occurredMs: fn.toString(fn.toUnixTimestamp64Milli(events.EventTime)),
        createdMs: fn.toString(fn.toUnixTimestamp64Milli(events.CreatedAt)),
        rawPayload: events.RawOcsfJson,
      })
      .where(({ and, eq, lt }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          eq(events.SourceId, input.sourceId),
          lt(events.EventTime, input.beforeMs),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .orderBy(events.EventTime, "DESC")
      .orderBy(events.EventId, "DESC")
      .limit(input.limit)
      .build();
    const { rows } = await ch.read({ statement });
    return rows.map((row) => PrismaActivityMonitorRepository.toPulledEvent(row));
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
      ch: await this.clickhouse(input.tenantId),
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
    const scope = tenantScope.single({ tenantId: args.tenantId });
    const ofSource = () =>
      [
        fn.mapGet(logs.Attributes, ATTR_ORIGIN_KIND),
        fn.mapGet(logs.Attributes, ATTR_INGESTION_SOURCE_ID),
      ] as const;
    const statement = clickhouseRead({ scope })
      .from(logs)
      .select(({ gte, scalar, and, eq }) => ({
        c24: fn.countIf(gte(logs.TimeUnixMs, args.since24h)),
        c7: fn.countIf(gte(logs.TimeUnixMs, args.since7d)),
        c30: fn.count(),
        lastMs: scalar((sub) =>
          sub
            .from(logs)
            .select({ lastMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(logs.TimeUnixMs))) })
            .where(() => {
              const [origin, source] = ofSource();
              return and(eq(origin, ORIGIN_KIND_VALUE), eq(source, args.sourceId));
            }),
        ),
      }))
      .where(({ and, eq, gte }) => {
        const [origin, source] = ofSource();
        return and(
          gte(logs.TimeUnixMs, args.since30d),
          eq(origin, ORIGIN_KIND_VALUE),
          eq(source, args.sourceId),
        );
      })
      .build();
    return (await args.ch.read({ statement })).rows[0];
  }

  private static async pulledEventWindowCounts(
    args: WindowCountArgs,
  ): Promise<WindowCountRow | undefined> {
    const scope = tenantScope.single({ tenantId: args.tenantId });
    const statement = clickhouseRead({ scope })
      .from(events)
      .select(({ gte, scalar, and, eq }) => ({
        c24: fn.countIf(gte(events.EventTime, args.since24h)),
        c7: fn.countIf(gte(events.EventTime, args.since7d)),
        c30: fn.count(),
        lastMs: scalar((sub) =>
          sub
            .from(events)
            .select({ lastMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(events.EventTime))) })
            .where(() =>
              and(
                fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
                eq(events.SourceId, args.sourceId),
              ),
            ),
        ),
      }))
      .where(({ and, eq, gte }) =>
        and(
          fn.startsWith(events.TraceId, PULLED_TRACE_PREFIX),
          eq(events.SourceId, args.sourceId),
          gte(events.EventTime, args.since30d),
        ),
      )
      // TraceId, SourceId and EventTime are the event's own: they never change across versions.
      .latestVersion({ repeat: [events.TraceId, events.SourceId, events.EventTime] })
      .build();
    return (await args.ch.read({ statement })).rows[0];
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

  private static toPulledEvent(row: {
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
  }): ActivityEventDetailRow {
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
