// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorService — read-side queries powering the /governance
 * admin dashboard.
 *
 * Reads from the unified trace store (the same `trace_summaries` +
 * `stored_log_records` tables every other LangWatch surface uses) filtered by
 * `Attributes['langwatch.origin.kind'] = "ingestion_source"`. The receiver
 * (langwatch/src/server/routes/ingest/ingestionRoutes.ts) stamps that marker
 * on every span/log record; trace-attribute-accumulation hoists it from
 * stored_spans into trace_summaries.Attributes so the rollup queries here
 * don't need to scan span-level data.
 *
 * Tenancy: every query filters by `TenantId = govProjectId` where
 * `govProjectId` is the org's hidden internal_governance Project (lazily
 * minted by `ensureHiddenGovernanceProject`). When the org has no Gov
 * Project yet (no IngestionSource has ever been minted), the queries
 * short-circuit to empty results.
 *
 * Anomaly counts (`openAnomalyCount` / `anomalyBreakdown`) read from
 * `prisma.anomalyAlert` — unaffected by the trace-store path.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/folds.feature
 *     (governance fold projection on trace_summaries / log_records)
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *     (single trace store, reserved namespaces)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { PROJECT_KIND } from "../governanceProject.service";

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

const ATTR_ORIGIN_KIND = "langwatch.origin.kind";
const ATTR_INGESTION_SOURCE_ID = "langwatch.ingestion_source.id";
const ATTR_USER_ID = "langwatch.user_id";
const ORIGIN_KIND_VALUE = "ingestion_source";

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

export class ActivityMonitorService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ActivityMonitorService {
    return new ActivityMonitorService(prisma);
  }

  /**
   * Resolves the org's hidden internal_governance Project ID. Returns null
   * when the org has no Gov Project yet (no IngestionSource has ever been
   * minted) — callers short-circuit to empty results in that case.
   */
  private async resolveGovProjectId(
    organizationId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  private async getClickhouse(
    organizationId: string,
  ): Promise<ClickHouseClient | null> {
    return await getClickHouseClientForOrganization(organizationId);
  }

  async summary(input: {
    organizationId: string;
    windowDays: number;
  }): Promise<SummaryResult> {
    const anomalyBreakdown = await this.openAnomalyBreakdown(
      input.organizationId,
    );
    const openAnomalyCount =
      anomalyBreakdown.critical + anomalyBreakdown.warning + anomalyBreakdown.info;

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { ...EMPTY_SUMMARY, openAnomalyCount, anomalyBreakdown };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { ...EMPTY_SUMMARY, openAnomalyCount, anomalyBreakdown };
    }

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const thisWindowStart = now - windowMs;
    const previousWindowStart = now - 2 * windowMs;

    const result = await ch.query({
      query: `
        SELECT
          sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})) AS thisSpend,
          sumIf(coalesce(ts.TotalCost, 0), ts.OccurredAt < fromUnixTimestamp64Milli({thisStart:UInt64})) AS prevSpend,
          uniqExactIf(
            ts.Attributes[{userKey:String}],
            ts.OccurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})
              AND ts.Attributes[{userKey:String}] != ''
          ) AS thisUsers
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: {
        tenantId: govProjectId,
        thisStart: thisWindowStart,
        prevStart: previousWindowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      thisSpend: number | string | null;
      prevSpend: number | string | null;
      thisUsers: number | string | null;
    }>;
    const row = rows[0];
    const thisSpend = Number(row?.thisSpend ?? 0);
    const prevSpend = Number(row?.prevSpend ?? 0);
    const thisUsers = Number(row?.thisUsers ?? 0);

    return {
      spentThisWindowUsd: thisSpend,
      windowOverPreviousPct: pctChange(thisSpend, prevSpend),
      activeUsersThisWindow: thisUsers,
      // newUsers requires a baseline-window comparison query which is a
      // follow-up (3b: governance_kpis fold materialises the per-user
      // first-seen). For now the dashboard renders the field but the value
      // is conservative — treat all active as new only when prev=0.
      newUsersThisWindow: prevSpend === 0 ? thisUsers : 0,
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

  async spendByUser(input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
  }): Promise<SpendByUserRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const limit = input.limit ?? 50;

    // ClickHouse 25.x resolves bare column names in ORDER BY to outer
    // aliases when the alias shadows a subquery column — so
    // `ORDER BY sum(spendUsd)` against an outer alias of `spendUsd =
    // toString(sum(...))` evaluates as sum-over-String and fails with
    // ILLEGAL_TYPE_OF_ARGUMENT (43). Aliasing the outer string to a
    // disjoint name (`spendUsdStr`) keeps the ORDER BY referring to the
    // subquery's Float64 spendUsd column.
    const result = await ch.query({
      query: `
        SELECT
          actor,
          toString(sum(spendUsd)) AS spendUsdStr,
          toString(count()) AS requests,
          toString(toUnixTimestamp64Milli(max(occurredAt))) AS lastActivityMs,
          any(model) AS mostUsedTarget
        FROM (
          SELECT
            ts.Attributes[{userKey:String}] AS actor,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt,
            arrayElement(ts.Models, 1) AS model
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
            AND ts.Attributes[{userKey:String}] != ''
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
              GROUP BY TenantId, TraceId
            )
        )
        GROUP BY actor
        ORDER BY sum(spendUsd) DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: govProjectId,
        windowStart: now - windowMs,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      actor: string;
      spendUsdStr: string;
      requests: string;
      lastActivityMs: string;
      mostUsedTarget: string | null;
    }>;
    return rows.map((r) => ({
      actor: r.actor,
      spendUsd: Number(r.spendUsdStr),
      requests: Number(r.requests),
      lastActivityIso: new Date(Number(r.lastActivityMs)).toISOString(),
      // Trend-vs-previous needs a windowed CTE comparison; deferred to 3b.
      trendVsPreviousPct: 0,
      mostUsedTarget: r.mostUsedTarget && r.mostUsedTarget !== "" ? r.mostUsedTarget : null,
    }));
  }

  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const sources = await this.prisma.ingestionSource.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    if (sources.length === 0) return [];

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    const ch = govProjectId
      ? await this.getClickhouse(input.organizationId)
      : null;

    const eventsBySource = new Map<string, number>();
    if (ch && govProjectId) {
      const sourceIds = sources.map((s) => s.id);
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const [traceCounts, logCounts] = await Promise.all([
        ch.query({
          query: `
            SELECT ts.Attributes[{sourceKey:String}] AS sourceId, toString(count()) AS c
            FROM trace_summaries ts
            WHERE ts.TenantId = {tenantId:String}
              AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
              AND ts.Attributes[{originKey:String}] = {originValue:String}
              AND ts.Attributes[{sourceKey:String}] IN ({sourceIds:Array(String)})
              AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
                SELECT TenantId, TraceId, max(UpdatedAt)
                FROM trace_summaries
                WHERE TenantId = {tenantId:String}
                  AND OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
                GROUP BY TenantId, TraceId
              )
            GROUP BY sourceId
          `,
          query_params: {
            tenantId: govProjectId,
            since,
            originKey: ATTR_ORIGIN_KIND,
            originValue: ORIGIN_KIND_VALUE,
            sourceKey: ATTR_INGESTION_SOURCE_ID,
            sourceIds,
          },
          format: "JSONEachRow",
        }),
        ch.query({
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
            tenantId: govProjectId,
            since,
            originKey: ATTR_ORIGIN_KIND,
            originValue: ORIGIN_KIND_VALUE,
            sourceKey: ATTR_INGESTION_SOURCE_ID,
            sourceIds,
          },
          format: "JSONEachRow",
        }),
      ]);
      const traceRows = (await traceCounts.json()) as Array<{
        sourceId: string;
        c: string;
      }>;
      const logRows = (await logCounts.json()) as Array<{
        sourceId: string;
        c: string;
      }>;
      for (const row of [...traceRows, ...logRows]) {
        eventsBySource.set(
          row.sourceId,
          (eventsBySource.get(row.sourceId) ?? 0) + Number(row.c),
        );
      }
    }

    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      sourceType: src.sourceType,
      status: src.status,
      lastEventIso: src.lastEventAt?.toISOString() ?? null,
      eventsLast24h: eventsBySource.get(src.id) ?? 0,
    }));
  }

  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const limit = input.limit ?? 50;
    const beforeMs = input.beforeIso ? new Date(input.beforeIso).getTime() : Date.now();

    // Pull recent traces for the source. Webhook log_records are out of
    // scope for this endpoint (the per-source detail page renders trace
    // shape; the log shape gets its own viewer in 3b).
    const result = await ch.query({
      query: `
        SELECT
          ts.TraceId AS eventId,
          ts.Attributes[{sourceTypeKey:String}] AS eventType,
          ts.Attributes[{userKey:String}] AS actor,
          arrayElement(ts.Models, 1) AS target,
          coalesce(ts.TotalCost, 0) AS costUsd,
          coalesce(ts.TotalPromptTokenCount, 0) AS tokensInput,
          coalesce(ts.TotalCompletionTokenCount, 0) AS tokensOutput,
          toString(toUnixTimestamp64Milli(ts.OccurredAt)) AS occurredMs,
          toString(toUnixTimestamp64Milli(ts.CreatedAt)) AS createdMs
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt < fromUnixTimestamp64Milli({beforeMs:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
            GROUP BY TenantId, TraceId
          )
        ORDER BY ts.OccurredAt DESC, ts.TraceId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: govProjectId,
        beforeMs,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        sourceTypeKey: "langwatch.ingestion_source.source_type",
        userKey: ATTR_USER_ID,
        sourceId: input.sourceId,
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      eventId: string;
      eventType: string;
      actor: string;
      target: string | null;
      costUsd: number | string;
      tokensInput: number | string;
      tokensOutput: number | string;
      occurredMs: string;
      createdMs: string;
    }>;
    return rows.map((r) => ({
      eventId: r.eventId,
      eventType: r.eventType ?? "",
      actor: r.actor ?? "",
      action: "trace.recorded",
      target: r.target ?? "",
      costUsd: Number(r.costUsd ?? 0),
      tokensInput: Number(r.tokensInput ?? 0),
      tokensOutput: Number(r.tokensOutput ?? 0),
      eventTimestampIso: new Date(Number(r.occurredMs)).toISOString(),
      ingestedAtIso: new Date(Number(r.createdMs)).toISOString(),
      rawPayload: "",
    }));
  }

  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { events24h: 0, events7d: 0, events30d: 0, lastSuccessIso: null };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { events24h: 0, events7d: 0, events30d: 0, lastSuccessIso: null };
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const since30d = now - 30 * day;

    const [traceResult, logResult] = await Promise.all([
      ch.query({
        query: `
          SELECT
            countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
            countIf(ts.OccurredAt >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
            count() AS c30,
            toString(toUnixTimestamp64Milli(max(ts.OccurredAt))) AS lastMs
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
            AND ts.Attributes[{sourceKey:String}] = {sourceId:String}
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({since30d:UInt64})
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: {
          tenantId: govProjectId,
          since24h: now - day,
          since7d: now - 7 * day,
          since30d,
          originKey: ATTR_ORIGIN_KIND,
          originValue: ORIGIN_KIND_VALUE,
          sourceKey: ATTR_INGESTION_SOURCE_ID,
          sourceId: input.sourceId,
        },
        format: "JSONEachRow",
      }),
      ch.query({
        query: `
          SELECT
            countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since24h:UInt64})) AS c24,
            countIf(lr.TimeUnixMs >= fromUnixTimestamp64Milli({since7d:UInt64})) AS c7,
            count() AS c30,
            toString(toUnixTimestamp64Milli(max(lr.TimeUnixMs))) AS lastMs
          FROM stored_log_records lr
          WHERE lr.TenantId = {tenantId:String}
            AND lr.TimeUnixMs >= fromUnixTimestamp64Milli({since30d:UInt64})
            AND lr.Attributes[{originKey:String}] = {originValue:String}
            AND lr.Attributes[{sourceKey:String}] = {sourceId:String}
        `,
        query_params: {
          tenantId: govProjectId,
          since24h: now - day,
          since7d: now - 7 * day,
          since30d,
          originKey: ATTR_ORIGIN_KIND,
          originValue: ORIGIN_KIND_VALUE,
          sourceKey: ATTR_INGESTION_SOURCE_ID,
          sourceId: input.sourceId,
        },
        format: "JSONEachRow",
      }),
    ]);
    const traceRows = (await traceResult.json()) as Array<{
      c24: number | string;
      c7: number | string;
      c30: number | string;
      lastMs: string | null;
    }>;
    const logRows = (await logResult.json()) as Array<{
      c24: number | string;
      c7: number | string;
      c30: number | string;
      lastMs: string | null;
    }>;
    const t = traceRows[0];
    const l = logRows[0];

    const events24h = Number(t?.c24 ?? 0) + Number(l?.c24 ?? 0);
    const events7d = Number(t?.c7 ?? 0) + Number(l?.c7 ?? 0);
    const events30d = Number(t?.c30 ?? 0) + Number(l?.c30 ?? 0);

    const traceLastMs = t?.lastMs ? Number(t.lastMs) : 0;
    const logLastMs = l?.lastMs ? Number(l.lastMs) : 0;
    const lastMs = Math.max(traceLastMs, logLastMs);
    const lastSuccessIso = lastMs > 0 ? new Date(lastMs).toISOString() : null;

    return { events24h, events7d, events30d, lastSuccessIso };
  }
}
