// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PersonalUsageService — read-only ClickHouse rollups powering the
 * /me dashboard.
 *
 * Personal usage is queried with one elegant trick: every personal
 * project has exactly one user (the workspace owner). So a query
 * scoped to `WHERE TenantId = personalProjectId` is *automatically*
 * scoped to that user — no userId column on trace_summaries needed,
 * no fan-out across the org.
 *
 * Every method:
 *   - Filters on the partition key (`OccurredAt`) so ClickHouse
 *     prunes partitions and skips cold-storage scans (per
 *     dev/docs/best_practices/clickhouse-queries.md).
 *   - Uses the IN-tuple dedup pattern when reading dedup-required
 *     fields (we lean on the trace_summary `argMax`-already-applied
 *     latest-version semantics; for sums + counts duplicates would
 *     be safe but we still defensively dedupe by TraceId via
 *     `argMax(TotalCost, UpdatedAt)`).
 *   - Settings: max_bytes_before_external_group_by lets large GROUP
 *     BYs spill to disk vs OOM under concurrent load.
 *
 * The dashboard reads the same shape regardless of whether the user
 * has 0 or 10k traces — we surface clear empty-state so the UI can
 * render "no usage yet" cards without special-case branching.
 */
import type { ClickHouseClient } from "@clickhouse/client";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";

export interface PersonalUsageWindow {
  /** Inclusive UTC start of the rollup window. */
  start: Date;
  /** Exclusive UTC end of the rollup window. */
  end: Date;
}

export interface PersonalUsageSummary {
  spentUsd: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Most-used model by request count, or null if no traces in window. */
  mostUsedModel: { name: string; usagePct: number } | null;
}

export interface PersonalUsageBucket {
  /** ISO date (YYYY-MM-DD) for the bucket. */
  day: string;
  spentUsd: number;
  requests: number;
}

export interface PersonalUsageBreakdown {
  label: string;
  spentUsd: number;
  requests: number;
}

export interface PersonalRecentActivity {
  traceId: string;
  occurredAt: string;
  models: string[];
  spentUsd: number;
  /** First ~120 chars of the input — useful for the activity list summary. */
  preview: string;
}

export interface PersonalUsageQueryInput {
  personalProjectId: string;
  /** Defaults to start-of-current-month → now if omitted. */
  window?: PersonalUsageWindow;
}

export class PersonalUsageService {
  /**
   * Returns aggregated spend + token + model summary for the window.
   * Empty state safe — returns zeros + null model if no traces.
   */
  async summary(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageSummary> {
    const window = input.window ?? defaultMonthWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return emptySummary();

    const summaryRow = await this.querySummary(client, {
      tenantId: input.personalProjectId,
      window,
    });
    const topModel = await this.queryTopModel(client, {
      tenantId: input.personalProjectId,
      window,
    });

    return {
      spentUsd: summaryRow.totalCost,
      requests: summaryRow.requestCount,
      promptTokens: summaryRow.promptTokens,
      completionTokens: summaryRow.completionTokens,
      mostUsedModel:
        topModel && summaryRow.requestCount > 0
          ? {
              name: topModel.model,
              usagePct: Math.round(
                (topModel.requests / summaryRow.requestCount) * 100,
              ),
            }
          : null,
    };
  }

  /**
   * Daily spend buckets across the window. UTC day boundaries.
   * Empty buckets are filled with zeros so the chart line connects.
   */
  async dailyBuckets(input: PersonalUsageQueryInput): Promise<PersonalUsageBucket[]> {
    const window = input.window ?? defaultLast14DaysWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return fillEmptyBuckets(window);

    const result = await client.query({
      query: `
        SELECT
          toDate(OccurredAt) AS Day,
          sum(SpentUsd)      AS SpentUsd,
          count()            AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(OccurredAt, UpdatedAt) AS OccurredAt,
            argMax(TotalCost, UpdatedAt)  AS SpentUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
          GROUP BY TraceId
        )
        GROUP BY Day
        ORDER BY Day
        SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.personalProjectId,
        fromMs: window.start.getTime(),
        toMs: window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawBucket = { Day: string; SpentUsd: number; Requests: number };
    const rows = (await result.json()) as RawBucket[];

    const byDay = new Map<string, { spentUsd: number; requests: number }>();
    for (const r of rows) {
      const existing = byDay.get(r.Day) ?? { spentUsd: 0, requests: 0 };
      existing.spentUsd += Number(r.SpentUsd) || 0;
      existing.requests += Number(r.Requests) || 0;
      byDay.set(r.Day, existing);
    }

    return fillEmptyBuckets(window, byDay);
  }

  /**
   * Per-model spend breakdown. Powers the "By tool" / "By model"
   * card on /me. Models come from `trace_summaries.Models` (an array
   * — we explode it via arrayJoin after the per-trace argMax dedup).
   *
   * Cost-attribution policy: a multi-model trace contributes its FULL
   * TotalCost to each model that appears in its Models array (so a
   * 3-model trace at $1 contributes $1 to each of the 3 models, total
   * $3). This is attribution-by-presence — accurate for "which tools
   * did the user actually invoke?" but inflates the per-model
   * percentage view. The /me/usage card uses this for relative
   * ordering (most-used model on top); precise per-model billing
   * lives in the gateway's per-call ledger, not this rollup.
   */
  async breakdownByModel(
    input: PersonalUsageQueryInput,
    limit = 8,
  ): Promise<PersonalUsageBreakdown[]> {
    const window = input.window ?? defaultMonthWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return [];

    const result = await client.query({
      query: `
        SELECT
          Model,
          sum(SpentUsd) AS SpentUsd,
          count()       AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt)         AS SpentUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY SpentUsd DESC
        LIMIT {lim:UInt32}
        SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.personalProjectId,
        fromMs: window.start.getTime(),
        toMs: window.end.getTime(),
        lim: limit,
      },
      format: "JSONEachRow",
    });

    type RawBreakdown = { Model: string; SpentUsd: number; Requests: number };
    const rows = (await result.json()) as RawBreakdown[];

    // Aggregate per-model since GROUP BY TraceId, Model returned per-trace rows.
    const aggregated = new Map<string, PersonalUsageBreakdown>();
    for (const r of rows) {
      const existing = aggregated.get(r.Model) ?? {
        label: r.Model,
        spentUsd: 0,
        requests: 0,
      };
      existing.spentUsd += Number(r.SpentUsd) || 0;
      existing.requests += Number(r.Requests) || 0;
      aggregated.set(r.Model, existing);
    }
    return Array.from(aggregated.values())
      .sort((a, b) => b.spentUsd - a.spentUsd)
      .slice(0, limit);
  }

  /**
   * Recent traces (last N) — drives the "Recent activity" list on
   * /me. Returns rich-enough rows to render summary + cost without
   * a follow-up trace fetch.
   */
  async recentActivity(
    input: PersonalUsageQueryInput,
    limit = 10,
  ): Promise<PersonalRecentActivity[]> {
    const window = input.window ?? defaultLast14DaysWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return [];

    const result = await client.query({
      query: `
        SELECT
          TraceId,
          argMax(OccurredAt, UpdatedAt) AS OccurredAt,
          argMax(Models, UpdatedAt)     AS Models,
          argMax(TotalCost, UpdatedAt)  AS SpentUsd,
          argMax(ComputedInput, UpdatedAt) AS Preview
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
          AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
        GROUP BY TraceId
        ORDER BY OccurredAt DESC
        LIMIT {lim:UInt32}
        SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.personalProjectId,
        fromMs: window.start.getTime(),
        toMs: window.end.getTime(),
        lim: limit,
      },
      format: "JSONEachRow",
    });

    type RawActivity = {
      TraceId: string;
      OccurredAt: string;
      Models: string[];
      SpentUsd: number;
      Preview: string | null;
    };
    const rows = (await result.json()) as RawActivity[];
    return rows.map((r) => ({
      traceId: r.TraceId,
      occurredAt: r.OccurredAt,
      models: r.Models ?? [],
      spentUsd: Number(r.SpentUsd) || 0,
      preview: (r.Preview ?? "").slice(0, 120),
    }));
  }

  // --- internals ---------------------------------------------------------

  private async querySummary(
    client: ClickHouseClient,
    params: { tenantId: string; window: PersonalUsageWindow },
  ): Promise<{
    totalCost: number;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
  }> {
    const result = await client.query({
      query: `
        SELECT
          sum(SpentUsd)        AS TotalCost,
          countDistinct(TraceId) AS RequestCount,
          sum(PromptTokens)    AS PromptTokens,
          sum(CompletionTokens) AS CompletionTokens
        FROM (
          SELECT
            TraceId,
            argMax(TotalCost, UpdatedAt)               AS SpentUsd,
            argMax(TotalPromptTokenCount, UpdatedAt)   AS PromptTokens,
            argMax(TotalCompletionTokenCount, UpdatedAt) AS CompletionTokens
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
          GROUP BY TraceId
        )
        SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: params.tenantId,
        fromMs: params.window.start.getTime(),
        toMs: params.window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawSummary = {
      TotalCost: number | null;
      RequestCount: number | null;
      PromptTokens: number | null;
      CompletionTokens: number | null;
    };
    const [row] = (await result.json()) as RawSummary[];
    if (!row) {
      return {
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
    }
    return {
      totalCost: Number(row.TotalCost) || 0,
      requestCount: Number(row.RequestCount) || 0,
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
    };
  }

  private async queryTopModel(
    client: ClickHouseClient,
    params: { tenantId: string; window: PersonalUsageWindow },
  ): Promise<{ model: string; requests: number } | null> {
    const result = await client.query({
      query: `
        SELECT
          Model,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY Requests DESC
        LIMIT 1
        SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: params.tenantId,
        fromMs: params.window.start.getTime(),
        toMs: params.window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawTopModel = { Model: string; Requests: number };
    const rows = (await result.json()) as RawTopModel[];
    const top = rows[0];
    if (!top) return null;
    return { model: top.Model, requests: Number(top.Requests) || 0 };
  }
}

// ----------------------------------------------------------------------------
// Window helpers
// ----------------------------------------------------------------------------

function defaultMonthWindow(): PersonalUsageWindow {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(now.getTime() + 1); // exclusive upper bound
  return { start, end };
}

function defaultLast14DaysWindow(): PersonalUsageWindow {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(today.getTime() - 13 * 24 * 60 * 60 * 1000);
  const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function fillEmptyBuckets(
  window: PersonalUsageWindow,
  data?: Map<string, { spentUsd: number; requests: number }>,
): PersonalUsageBucket[] {
  const buckets: PersonalUsageBucket[] = [];
  const cursor = new Date(window.start.getTime());
  while (cursor < window.end) {
    const day = cursor.toISOString().slice(0, 10);
    const v = data?.get(day);
    buckets.push({
      day,
      spentUsd: v?.spentUsd ?? 0,
      requests: v?.requests ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function emptySummary(): PersonalUsageSummary {
  return {
    spentUsd: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    mostUsedModel: null,
  };
}

function formatSettings(settings: Record<string, number | string>): string {
  return Object.entries(settings)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
}
