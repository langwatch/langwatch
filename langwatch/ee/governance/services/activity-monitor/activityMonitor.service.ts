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
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "../governanceAttributeKeys";

export interface SummaryResult {
  spentThisWindowUsd: number;
  windowOverPreviousPct: number;
  /**
   * False when the previous-window spend was zero (no baseline data
   * to compare against). UI mutes the trend subline rather than
   * rendering '↑ 100% vs previous' on every brand-new org. Same
   * semantics as `SpendByTeamRow.hasPriorBaseline`.
   */
  hasPriorBaseline: boolean;
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
  /**
   * False when the previous-window spend was zero (no baseline data).
   * UI mutes the trend cell rather than rendering a misleading
   * percentage on first-window users. Currently always `false` until
   * the per-user prior-window CTE lands (paired with `trendVsPreviousPct`,
   * which still hard-zeros today).
   */
  hasPriorBaseline: boolean;
  mostUsedTarget: string | null;
}

export interface SpendByTeamRow {
  /** Team.id, or null for sources that aren't team-scoped (org-wide). */
  teamId: string | null;
  /** Team.name, or "Org-wide" for non-team-scoped sources. */
  teamName: string;
  spendUsd: number;
  requestCount: number;
  /**
   * Spend change vs the previous equal-length window (e.g. last 30
   * days vs the 30 days before that). 0 when previous window had no
   * spend AND current is also empty; 100 when previous was zero and
   * current is non-zero (matches `summary.windowOverPreviousPct`).
   * UI should consult `hasPriorBaseline` before rendering this as a
   * percentage — `100` is overloaded (real doubling vs zero-baseline
   * artifact).
   */
  deltaPctVsPriorWindow: number;
  /**
   * False when the previous-window spend was zero (no baseline data
   * to compare against). UI mutes the trend cell to '—' rather than
   * showing a misleading +100% on every brand-new team.
   */
  hasPriorBaseline: boolean;
  lastActivityIso: string | null;
  /** Number of distinct ingestion sources rolled up under this team. */
  sourceCount: number;
}

export interface IngestionSourceHealthRow {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  lastEventIso: string | null;
  eventsLast24h: number;
}

/** One bucket-major entry in the spend-over-time time series. */
export interface SpendOverTimeBucket {
  /** Day-aligned ISO timestamp (UTC midnight). */
  bucketIso: string;
  /**
   * One point per group-key with non-zero spend in this bucket. Empty
   * array when nothing spent on this day across any group; the bucket
   * is still emitted so the chart's X axis has no gaps.
   */
  points: Array<{
    /**
     * Stable group identifier — teamId, user_id, or model name. Used
     * for color-derivation (name-hash) + click-through scope params.
     */
    key: string;
    /** Human-readable label for legend / tooltip. */
    label: string;
    spendUsd: number;
  }>;
}

export interface SpendOverTimeResult {
  buckets: SpendOverTimeBucket[];
}

export type SpendOverTimeGroupBy = "team" | "user" | "model";

/** Sort field accepted by `spendByUser` / `spendByTeam`. */
export type SpendSortField = "spend" | "requests" | "lastActivity";
export type SortDir = "asc" | "desc";

/**
 * Whitelist mapping from external sort field names to the aggregate
 * expressions we splice into the ORDER BY clause. CH parameter binding
 * does NOT support column-name interpolation; this whitelist is the
 * boundary that prevents injection through the public API.
 */
const SORT_FIELD_TO_AGG_EXPR: Record<SpendSortField, string> = {
  spend: "sum(spendUsd)",
  requests: "count()",
  lastActivity: "max(occurredAt)",
};

/**
 * Per-row sort key extractors for the in-memory `spendByTeam` ranker.
 * Pagination + sort happen post-aggregation in TS because the team
 * rollup happens after a PG join (CH only sees sourceId, the team
 * mapping is in PG). All keys are numeric so the comparator stays
 * stable regardless of locale.
 */
const TEAM_ROW_SORT_KEYS: Record<
  SpendSortField,
  (row: {
    thisSpend: number;
    requestCount: number;
    lastActivityMs: number;
  }) => number
> = {
  spend: (r) => r.thisSpend,
  requests: (r) => r.requestCount,
  lastActivity: (r) => r.lastActivityMs,
};

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

export interface RecentAnomalyRow {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  severity: "critical" | "warning" | "info";
  triggerWindowStartIso: string;
  triggerWindowEndIso: string;
  triggerSpendUsd: number | null;
  triggerEventCount: number | null;
  detectedAtIso: string;
  state: string;
  currentState: "open" | "acknowledged" | "resolved";
  detail: Record<string, unknown>;
  /** Back-compat alias — same as `ruleName`, used by the iter-10 dashboard renderer. */
  rule: string;
  /** Best-effort source label pulled from `detail` for the dashboard row. */
  sourceLabel: string;
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
  hasPriorBaseline: false,
  activeUsersThisWindow: 0,
  newUsersThisWindow: 0,
  openAnomalyCount: 0,
  anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
};

const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_USER_ID = GOVERNANCE_ATTR.USER_ID;
const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function extractSourceLabel(detail: unknown): string {
  const d = (detail as Record<string, unknown>) ?? {};
  if (typeof d.sourceLabel === "string") return d.sourceLabel;
  if (typeof d.source === "string") return d.source;
  return "";
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

function emptyDenseBuckets(
  windowStartMs: number,
  windowDays: number,
): SpendOverTimeBucket[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: SpendOverTimeBucket[] = [];
  for (let i = 0; i < windowDays; i++) {
    buckets.push({
      bucketIso: new Date(windowStartMs + i * dayMs).toISOString(),
      points: [],
    });
  }
  return buckets;
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
      hasPriorBaseline: prevSpend > 0,
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
    offset?: number;
    sortBy?: SpendSortField;
    sortDir?: SortDir;
  }): Promise<SpendByUserRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const limit = input.limit ?? 50;
    const offset = Math.max(0, input.offset ?? 0);
    const sortBy = input.sortBy ?? "spend";
    const sortDir = input.sortDir ?? "desc";
    // Whitelist the ORDER BY expression — the sortBy/sortDir values come
    // from a Zod enum at the route layer but we re-validate here so a
    // direct service-layer caller (tests, scripts) can't smuggle SQL.
    const orderExpr = SORT_FIELD_TO_AGG_EXPR[sortBy];
    const orderDir = sortDir === "asc" ? "ASC" : "DESC";

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
        ORDER BY ${orderExpr} ${orderDir}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        tenantId: govProjectId,
        windowStart: now - windowMs,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        userKey: ATTR_USER_ID,
        limit,
        offset,
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
      hasPriorBaseline: false,
      mostUsedTarget: r.mostUsedTarget && r.mostUsedTarget !== "" ? r.mostUsedTarget : null,
    }));
  }

  /**
   * Per-team spend rollup for the admin governance home — the
   * organization-wide bird's-eye view that complements `spendByUser`
   * (top spenders) with the team breakdown.
   *
   * Implementation: each `IngestionSource` row carries an optional
   * `teamId` (PG schema), and every span/log_record persisted from
   * that source carries the source id in
   * `Attributes['langwatch.ingestion_source.id']`. We aggregate spend
   * + request count per source in ClickHouse, then roll those rows up
   * by team via a PG join. Sources with `teamId = null` aggregate
   * under the "Org-wide" bucket so org-wide ingestion (e.g., a
   * tenant-spanning compliance feed) still surfaces in the dashboard.
   *
   * RBAC: caller is responsible for the org-membership check (the
   * existing `requireEnterprisePlan` + `checkOrganizationPermission`
   * middleware on the tRPC procedure handle that). Service-side
   * defense-in-depth: every CH query filters by `TenantId =
   * govProjectId`, where `govProjectId` is the caller's hidden
   * Governance Project — cross-org leak is structurally impossible.
   */
  async spendByTeam(input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
    offset?: number;
    sortBy?: SpendSortField;
    sortDir?: SortDir;
  }): Promise<SpendByTeamRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const limit = input.limit ?? 50;
    const offset = Math.max(0, input.offset ?? 0);
    const sortBy = input.sortBy ?? "spend";
    const sortDir = input.sortDir ?? "desc";

    const previousWindowStart = now - 2 * windowMs;
    const result = await ch.query({
      query: `
        SELECT
          sourceId,
          toString(sumIf(spendUsd, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisSpendStr,
          toString(sumIf(spendUsd, occurredAt < fromUnixTimestamp64Milli({thisStart:UInt64}))) AS prevSpendStr,
          toString(countIf(occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64}))) AS thisRequests,
          toString(toUnixTimestamp64Milli(maxIf(occurredAt, occurredAt >= fromUnixTimestamp64Milli({thisStart:UInt64})))) AS lastActivityMs
        FROM (
          SELECT
            ts.Attributes[{sourceKey:String}] AS sourceId,
            coalesce(ts.TotalCost, 0) AS spendUsd,
            ts.OccurredAt AS occurredAt
          FROM trace_summaries ts
          WHERE ts.TenantId = {tenantId:String}
            AND ts.OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
            AND ts.Attributes[{originKey:String}] = {originValue:String}
            AND ts.Attributes[{sourceKey:String}] != ''
            AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= fromUnixTimestamp64Milli({prevStart:UInt64})
              GROUP BY TenantId, TraceId
            )
        )
        GROUP BY sourceId
      `,
      query_params: {
        tenantId: govProjectId,
        thisStart: now - windowMs,
        prevStart: previousWindowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
      },
      format: "JSONEachRow",
    });

    const sourceRows = (await result.json()) as Array<{
      sourceId: string;
      thisSpendStr: string;
      prevSpendStr: string;
      thisRequests: string;
      lastActivityMs: string;
    }>;
    if (sourceRows.length === 0) return [];

    const sourceIds = sourceRows.map((r) => r.sourceId).filter((id) => id !== "");
    const sources = await this.prisma.ingestionSource.findMany({
      where: { id: { in: sourceIds }, organizationId: input.organizationId },
      select: {
        id: true,
        teamId: true,
        team: { select: { id: true, name: true } },
      },
    });
    const teamBySource = new Map(
      sources.map((s) => [s.id, s.team] as const),
    );

    const ORG_WIDE_KEY = "__org_wide__";
    const byTeam = new Map<
      string,
      {
        teamId: string | null;
        teamName: string;
        thisSpend: number;
        prevSpend: number;
        requestCount: number;
        lastActivityMs: number;
        sourceCount: number;
      }
    >();
    for (const row of sourceRows) {
      const team = teamBySource.get(row.sourceId) ?? null;
      const key = team ? team.id : ORG_WIDE_KEY;
      const teamId = team?.id ?? null;
      const teamName = team?.name ?? "Org-wide";
      const thisSpend = Number(row.thisSpendStr);
      const prevSpend = Number(row.prevSpendStr);
      const requestCount = Number(row.thisRequests);
      const lastActivityMs = Number(row.lastActivityMs);
      const existing = byTeam.get(key);
      if (existing) {
        existing.thisSpend += thisSpend;
        existing.prevSpend += prevSpend;
        existing.requestCount += requestCount;
        existing.sourceCount += 1;
        existing.lastActivityMs = Math.max(existing.lastActivityMs, lastActivityMs);
      } else {
        byTeam.set(key, {
          teamId,
          teamName,
          thisSpend,
          prevSpend,
          requestCount,
          lastActivityMs,
          sourceCount: 1,
        });
      }
    }

    const sortKey = TEAM_ROW_SORT_KEYS[sortBy];
    const sign = sortDir === "asc" ? 1 : -1;
    return [...byTeam.values()]
      .filter((t) => t.thisSpend > 0 || t.requestCount > 0)
      .sort((a, b) => sign * (sortKey(a) - sortKey(b)))
      .slice(offset, offset + limit)
      .map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        spendUsd: t.thisSpend,
        requestCount: t.requestCount,
        deltaPctVsPriorWindow: pctChange(t.thisSpend, t.prevSpend),
        hasPriorBaseline: t.prevSpend > 0,
        lastActivityIso:
          t.lastActivityMs > 0
            ? new Date(t.lastActivityMs).toISOString()
            : null,
        sourceCount: t.sourceCount,
      }));
  }

  /**
   * Time-series spend rollup for the bird's-eye `<SpendOverTimeChart>`.
   * Bucketed daily, grouped by team / user / model. The wire shape is
   * bucket-major (one entry per day with all non-zero groups inside)
   * which round-trips exactly the cross-product the chart legend
   * needs without any client-side reshape gymnastics.
   *
   * Density invariant: `buckets` covers every day in the window, even
   * empty ones — Recharts AreaChart with `stackId="1"` requires a
   * dense X axis or it draws gaps that visually misrepresent quiet
   * days as "missing data". Empty days surface as `points: []`.
   *
   * Tenancy: same as every other read in this service — every CH query
   * filters by `TenantId = govProjectId`. groupBy='team' rolls up
   * IngestionSource rows (CH-side spend) by their teamId via a PG join
   * (Org-wide bucket for null-teamId sources). groupBy='user' /
   * 'model' read the corresponding attribute / Models[1] directly.
   *
   * Spec: specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
   *   §"Spend-over-time stacked-area chart renders by team"
   *   §"spendOverTime API contract"
   *   §"spendOverTime CH query honors TenantId scoping"
   */
  async spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    const windowDays = Math.max(1, Math.floor(input.windowDays));
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const todayStart = startOfUtcDay(now);
    const windowStart = todayStart - (windowDays - 1) * dayMs;

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { buckets: emptyDenseBuckets(windowStart, windowDays) };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { buckets: emptyDenseBuckets(windowStart, windowDays) };
    }

    const groupExpr =
      input.groupBy === "team"
        ? `ts.Attributes[{sourceKey:String}]`
        : input.groupBy === "user"
          ? `ts.Attributes[{userKey:String}]`
          : `arrayElement(ts.Models, 1)`;

    // `OccurredAt` is DateTime64(3, 'UTC'). `toStartOfDay()` returns
    // plain `DateTime` (seconds resolution), and `toUnixTimestamp64Milli`
    // refuses anything but DateTime64 — so we go the other way:
    // `toUnixTimestamp()` gives seconds, then multiply by 1000 to get
    // millisecond ticks. Same wire shape as `toUnixTimestamp64Milli`
    // would produce; matches the JS-side `windowStart`/dayMs math.
    //
    // Two earlier shapes that DON'T work:
    //   `toUnixTimestamp64Milli(toStartOfDay(OccurredAt))` → type error
    //     (DateTime, not DateTime64)
    //   `toUnixTimestamp64Milli(toStartOfDay(toDateTime64(OccurredAt/1000, 3)))`
    //     → divides ms-precision by 1000 then re-wraps, double-shifting
    //     every bucket far outside the window
    const result = await ch.query({
      query: `
        SELECT
          toString(toUnixTimestamp(toStartOfDay(ts.OccurredAt)) * 1000) AS bucketMs,
          ${groupExpr} AS groupKey,
          toString(sum(coalesce(ts.TotalCost, 0))) AS spendUsdStr
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({windowStart:UInt64})
            GROUP BY TenantId, TraceId
          )
        GROUP BY bucketMs, groupKey
        ORDER BY bucketMs ASC
      `,
      query_params: {
        tenantId: govProjectId,
        windowStart,
        originKey: ATTR_ORIGIN_KIND,
        originValue: ORIGIN_KIND_VALUE,
        sourceKey: ATTR_INGESTION_SOURCE_ID,
        userKey: ATTR_USER_ID,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      bucketMs: string;
      groupKey: string | null;
      spendUsdStr: string;
    }>;

    let labelByKey: Map<string, { key: string; label: string }>;
    let rolledRows: Array<{ bucketMs: number; key: string; spendUsd: number }>;

    if (input.groupBy === "team") {
      const sourceIds = Array.from(
        new Set(
          rows
            .map((r) => r.groupKey)
            .filter((s): s is string => typeof s === "string" && s !== ""),
        ),
      );
      const sources = sourceIds.length
        ? await this.prisma.ingestionSource.findMany({
            where: {
              id: { in: sourceIds },
              organizationId: input.organizationId,
            },
            select: {
              id: true,
              team: { select: { id: true, name: true } },
            },
          })
        : [];
      const teamBySource = new Map(sources.map((s) => [s.id, s.team] as const));
      const ORG_WIDE_KEY = "__org_wide__";
      labelByKey = new Map();
      rolledRows = [];
      for (const row of rows) {
        const sourceId = row.groupKey ?? "";
        if (!sourceId) continue;
        const team = teamBySource.get(sourceId) ?? null;
        const key = team?.id ?? ORG_WIDE_KEY;
        const label = team?.name ?? "Org-wide";
        labelByKey.set(key, { key, label });
        rolledRows.push({
          bucketMs: Number(row.bucketMs),
          key,
          spendUsd: Number(row.spendUsdStr),
        });
      }
    } else {
      labelByKey = new Map();
      rolledRows = [];
      for (const row of rows) {
        const key = row.groupKey ?? "";
        if (!key) continue;
        labelByKey.set(key, { key, label: key });
        rolledRows.push({
          bucketMs: Number(row.bucketMs),
          key,
          spendUsd: Number(row.spendUsdStr),
        });
      }
    }

    // Roll up (bucket, key) duplicates that come out of the team-side
    // sourceId → teamId remapping (multiple sources can share one team).
    const aggregated = new Map<string, number>();
    for (const r of rolledRows) {
      const k = `${r.bucketMs}::${r.key}`;
      aggregated.set(k, (aggregated.get(k) ?? 0) + r.spendUsd);
    }

    const buckets = emptyDenseBuckets(windowStart, windowDays);
    const bucketIndexByMs = new Map(
      buckets.map((b, i) => [Date.parse(b.bucketIso), i] as const),
    );
    for (const [composite, spendUsd] of aggregated.entries()) {
      const sep = composite.indexOf("::");
      const bucketMs = Number(composite.slice(0, sep));
      const key = composite.slice(sep + 2);
      const idx = bucketIndexByMs.get(bucketMs);
      if (idx === undefined) continue;
      const meta = labelByKey.get(key);
      if (!meta) continue;
      if (spendUsd <= 0) continue;
      buckets[idx]!.points.push({
        key: meta.key,
        label: meta.label,
        spendUsd,
      });
    }

    // Stable per-bucket ordering — descending spend so the largest
    // contributor renders at the bottom of the stacked area (Recharts
    // stacks in array order; bottom-up = largest-first).
    for (const bucket of buckets) {
      bucket.points.sort((a, b) => b.spendUsd - a.spendUsd);
    }

    return { buckets };
  }

  /**
   * Recent anomaly alerts produced by the anomaly-detection reactor.
   * Read-only snapshot of `prisma.anomalyAlert` rows for the org,
   * sorted by detectedAt DESC. Returns `[]` for orgs with no alerts
   * — callers render the empty-state in the dashboard.
   */
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
      triggerSpendUsd: row.triggerSpendUsd
        ? Number(row.triggerSpendUsd.toString())
        : null,
      triggerEventCount: row.triggerEventCount,
      detectedAtIso: row.detectedAt.toISOString(),
      state: row.state,
      currentState: row.state as "open" | "acknowledged" | "resolved",
      detail: row.detail as Record<string, unknown>,
      // Back-compat aliases for the existing /governance dashboard
      // (renderer was sketched against the iter-10 mock shape).
      rule: row.ruleName,
      sourceLabel: extractSourceLabel(row.detail),
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
        sourceTypeKey: GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE,
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
