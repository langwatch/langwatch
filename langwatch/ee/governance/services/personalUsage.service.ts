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

import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
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
  /** Theoretical (list-price) spend — the grand total regardless of plan. */
  spentUsd: number;
  /**
   * Portion actually billed per token. Excludes bundled / non-billable spend
   * (e.g. a Claude Max session), so it reflects real money out the door.
   */
  billedUsd: number;
  requests: number;
}

export interface PersonalUsageBreakdown {
  label: string;
  /** Theoretical (list-price) spend for this model/tool. */
  spentUsd: number;
  /** Portion actually billed per token (excludes bundled spend). */
  billedUsd: number;
  requests: number;
}

export interface PersonalUsageQueryInput {
  personalProjectId: string;
  /** Defaults to start-of-current-month → now if omitted. */
  window?: PersonalUsageWindow;
  /**
   * Owner's userId. When supplied, the service unions in any
   * gateway_budget_ledger_events written under PRINCIPAL scope for
   * this user — picks up Claude Code OTLP / other ingestion-source
   * traffic that lands under the hidden Governance Project tenant
   * rather than the user's personal-project tenant. Without it,
   * summaries / buckets / breakdowns reflect only gateway-VK traffic.
   */
  userId?: string;
}

/**
 * gateway_budget_ledger_events schema — captured here so callers
 * outside the budget repository can reason about it.
 *
 * Receivers (gateway VK fold + claude_code OTLP receiver) write one
 * row per (request, applicable budget). The ReplacingMergeTree
 * collapses replays on (TenantId, BudgetId, GatewayRequestId).
 *
 *   TenantId: hidden Governance Project id (for ingestion sources) or
 *             the trace's tenantId (for gateway VKs).
 *   Scope:    one of ORGANIZATION / TEAM / PROJECT / VIRTUAL_KEY /
 *             PRINCIPAL — matches the budget that was applicable.
 *   ScopeId:  the budget's scopeId (org/team/project/vk id, or for
 *             PRINCIPAL the User.id).
 *   AmountUSD, TokensInput, TokensOutput, Model, OccurredAt, etc.
 *
 * Personal-usage queries pin Scope='principal' (lowercase, matching
 * `scopeToClickHouse` in budget.clickhouse.repository.ts:539) AND
 * ScopeId=userId so
 * we get exactly the per-user ledger rows. Multi-budget events show
 * up multiple times across scope rows (one row per applicable budget),
 * but the Scope/ScopeId pair narrows to the user's principal slice
 * cleanly.
 */

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

    // Ingestion-source events (Claude Code OTLP, etc.) land under the
    // hidden governance project tenant, NOT the user's personal
    // project — so the trace_summaries query above misses them. Pull
    // per-principal ledger rows and merge.
    const ingestion = input.userId
      ? await this.queryIngestionPrincipalSummary(client, {
          userId: input.userId,
          window,
        })
      : null;

    const totalCost = summaryRow.totalCost + (ingestion?.totalCost ?? 0);
    const totalRequests =
      summaryRow.requestCount + (ingestion?.requestCount ?? 0);
    const totalPromptTokens =
      summaryRow.promptTokens + (ingestion?.promptTokens ?? 0);
    const totalCompletionTokens =
      summaryRow.completionTokens + (ingestion?.completionTokens ?? 0);

    // Most-used model: prefer the larger requestCount source
    // (gateway-VK vs ingestion). When both have data, pick the one
    // contributing more requests to the user's total. Recompute
    // usagePct against the merged total so the percentage reflects
    // the union, not just the per-source slice.
    let mergedTopModel: { name: string; requests: number } | null = null;
    if (topModel && summaryRow.requestCount > 0) {
      mergedTopModel = { name: topModel.model, requests: topModel.requests };
    }
    if (
      ingestion?.topModel &&
      (!mergedTopModel ||
        ingestion.topModel.requests > mergedTopModel.requests)
    ) {
      mergedTopModel = ingestion.topModel;
    }

    return {
      spentUsd: totalCost,
      requests: totalRequests,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      mostUsedModel:
        mergedTopModel && totalRequests > 0
          ? {
              name: mergedTopModel.name,
              usagePct: Math.round(
                (mergedTopModel.requests / totalRequests) * 100,
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
          toDate(LatestOccurredAt) AS Day,
          sum(SpentUsd)            AS SpentUsd,
          sum(if(NonBillable = 'true', 0, SpentUsd)) AS BilledUsd,
          count()                  AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
            argMax(TotalCost, UpdatedAt)  AS SpentUsd,
            argMax(Attributes['langwatch.cost.non_billable'], UpdatedAt) AS NonBillable
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

    type RawBucket = {
      Day: string;
      SpentUsd: number;
      BilledUsd: number;
      Requests: number;
    };
    const rows = (await result.json()) as RawBucket[];

    const byDay = new Map<
      string,
      { spentUsd: number; billedUsd: number; requests: number }
    >();
    for (const r of rows) {
      const existing = byDay.get(r.Day) ?? {
        spentUsd: 0,
        billedUsd: 0,
        requests: 0,
      };
      existing.spentUsd += Number(r.SpentUsd) || 0;
      existing.billedUsd += Number(r.BilledUsd) || 0;
      existing.requests += Number(r.Requests) || 0;
      byDay.set(r.Day, existing);
    }

    // Ingestion-source ledger union: per-day spend for the user's
    // PRINCIPAL-scope rows, merged into the same byDay map.
    if (input.userId) {
      const ledgerBuckets = await this.queryIngestionPrincipalBuckets(client, {
        userId: input.userId,
        window,
      });
      for (const r of ledgerBuckets) {
        const existing = byDay.get(r.day) ?? {
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
        };
        existing.spentUsd += r.spentUsd;
        existing.billedUsd += r.billedUsd;
        existing.requests += r.requests;
        byDay.set(r.day, existing);
      }
    }

    return fillEmptyBuckets(window, byDay);
  }

  private async queryIngestionPrincipalBuckets(
    client: ClickHouseClient,
    params: { userId: string; window: PersonalUsageWindow },
  ): Promise<PersonalUsageBucket[]> {
    if (!isClickHouseEnabled()) return [];
    try {
      const result = await client.query({
        query: `
          SELECT
            toDate(OccurredAt) AS Day,
            sum(AmountUSD)     AS SpentUsd,
            countDistinct(GatewayRequestId) AS Requests
          FROM gateway_budget_ledger_events
          WHERE Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Day
          ORDER BY Day
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          userId: params.userId,
          fromMs: params.window.start.getTime(),
          toMs: params.window.end.getTime(),
        },
        format: "JSONEachRow",
      });
      type Raw = { Day: string; SpentUsd: number; Requests: number };
      const rows = (await result.json()) as Raw[];
      return rows.map((r) => {
        const spentUsd = Number(r.SpentUsd) || 0;
        // The gateway ledger records real per-token spend (virtual-key
        // traffic the customer pays for), so it is fully billed.
        return {
          day: r.Day,
          spentUsd,
          billedUsd: spentUsd,
          requests: Number(r.Requests) || 0,
        };
      });
    } catch {
      return [];
    }
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
          sum(if(NonBillable = 'true', 0, SpentUsd)) AS BilledUsd,
          count()       AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt)         AS SpentUsd,
            argMax(Attributes['langwatch.cost.non_billable'], UpdatedAt) AS NonBillable
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

    type RawBreakdown = {
      Model: string;
      SpentUsd: number;
      BilledUsd: number;
      Requests: number;
    };
    const rows = (await result.json()) as RawBreakdown[];

    // Aggregate per-model since GROUP BY TraceId, Model returned per-trace rows.
    const aggregated = new Map<string, PersonalUsageBreakdown>();
    for (const r of rows) {
      const existing = aggregated.get(r.Model) ?? {
        label: r.Model,
        spentUsd: 0,
        billedUsd: 0,
        requests: 0,
      };
      existing.spentUsd += Number(r.SpentUsd) || 0;
      existing.billedUsd += Number(r.BilledUsd) || 0;
      existing.requests += Number(r.Requests) || 0;
      aggregated.set(r.Model, existing);
    }

    // Ingestion-source ledger union: per-model spend for the user's
    // PRINCIPAL-scope rows, merged into the same map.
    if (input.userId) {
      const ledgerBreakdown = await this.queryIngestionPrincipalBreakdown(
        client,
        { userId: input.userId, window },
      );
      for (const r of ledgerBreakdown) {
        const existing = aggregated.get(r.label) ?? {
          label: r.label,
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
        };
        existing.spentUsd += r.spentUsd;
        existing.billedUsd += r.billedUsd;
        existing.requests += r.requests;
        aggregated.set(r.label, existing);
      }
    }

    return Array.from(aggregated.values())
      .sort((a, b) => b.spentUsd - a.spentUsd)
      .slice(0, limit);
  }

  private async queryIngestionPrincipalBreakdown(
    client: ClickHouseClient,
    params: { userId: string; window: PersonalUsageWindow },
  ): Promise<PersonalUsageBreakdown[]> {
    if (!isClickHouseEnabled()) return [];
    try {
      const result = await client.query({
        query: `
          SELECT
            Model AS Label,
            sum(AmountUSD)             AS SpentUsd,
            countDistinct(GatewayRequestId) AS Requests
          FROM gateway_budget_ledger_events
          WHERE Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Label
          ORDER BY SpentUsd DESC
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          userId: params.userId,
          fromMs: params.window.start.getTime(),
          toMs: params.window.end.getTime(),
        },
        format: "JSONEachRow",
      });
      type Raw = { Label: string; SpentUsd: number; Requests: number };
      const rows = (await result.json()) as Raw[];
      return rows.map((r) => {
        const spentUsd = Number(r.SpentUsd) || 0;
        // Gateway ledger spend is real per-token spend, so fully billed.
        return {
          label: r.Label,
          spentUsd,
          billedUsd: spentUsd,
          requests: Number(r.Requests) || 0,
        };
      });
    } catch {
      return [];
    }
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

  /**
   * Per-user spend rollup from `gateway_budget_ledger_events` filtered
   * to PRINCIPAL-scope rows for this user. Picks up Claude Code OTLP /
   * other ingestion-source events that don't land in the user's
   * personal-project trace_summaries.
   *
   * Caveats:
   *   - Only catches events that hit a PRINCIPAL-scope budget. Events
   *     that only hit ORG/PROJECT-scope budgets undercount here. v2
   *     fix: write per-user rows on every ingestion event regardless of
   *     scope (or pivot the receiver to write to user's personal
   *     project tenant directly so the existing trace_summaries query
   *     captures them).
   *   - `request_id` is the dedup key on the underlying
   *     ReplacingMergeTree. We sum `AmountUSD` directly — duplicates
   *     across (Scope, BudgetId) for the same request are deduped at
   *     the (TenantId, BudgetId, GatewayRequestId) ORDER BY level.
   *     Filtering Scope='PRINCIPAL' already isolates to one row per
   *     request per user.
   */
  private async queryIngestionPrincipalSummary(
    client: ClickHouseClient,
    params: { userId: string; window: PersonalUsageWindow },
  ): Promise<{
    totalCost: number;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    topModel: { name: string; requests: number } | null;
  } | null> {
    if (!isClickHouseEnabled()) return null;
    try {
      const result = await client.query({
        query: `
          SELECT
            sum(AmountUSD)            AS TotalCost,
            countDistinct(GatewayRequestId) AS RequestCount,
            sum(TokensInput)          AS PromptTokens,
            sum(TokensOutput)         AS CompletionTokens
          FROM gateway_budget_ledger_events
          WHERE Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          userId: params.userId,
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
      if (!row || !Number(row.RequestCount)) return null;

      const topModelResult = await client.query({
        query: `
          SELECT
            Model AS Name,
            countDistinct(GatewayRequestId) AS Requests
          FROM gateway_budget_ledger_events
          WHERE Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Model
          ORDER BY Requests DESC
          LIMIT 1
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          userId: params.userId,
          fromMs: params.window.start.getTime(),
          toMs: params.window.end.getTime(),
        },
        format: "JSONEachRow",
      });
      type RawTop = { Name: string; Requests: number | null };
      const [topRow] = (await topModelResult.json()) as RawTop[];

      return {
        totalCost: Number(row.TotalCost) || 0,
        requestCount: Number(row.RequestCount) || 0,
        promptTokens: Number(row.PromptTokens) || 0,
        completionTokens: Number(row.CompletionTokens) || 0,
        topModel: topRow
          ? { name: topRow.Name, requests: Number(topRow.Requests) || 0 }
          : null,
      };
    } catch {
      // CH unavailable / table not provisioned. Personal usage
      // queries already render zeros gracefully when the trace path
      // misses; do the same for the ingestion-ledger union.
      return null;
    }
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
  data?: Map<string, { spentUsd: number; billedUsd: number; requests: number }>,
): PersonalUsageBucket[] {
  const buckets: PersonalUsageBucket[] = [];
  const cursor = new Date(window.start.getTime());
  while (cursor < window.end) {
    const day = cursor.toISOString().slice(0, 10);
    const v = data?.get(day);
    buckets.push({
      day,
      spentUsd: v?.spentUsd ?? 0,
      billedUsd: v?.billedUsd ?? 0,
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
