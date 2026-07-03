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
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  CATEGORIES,
  type Category,
} from "~/server/app-layer/traces/block-classification/categories";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "./governanceAttributeKeys";

const logger = createLogger("langwatch:personal-usage");

export interface PersonalUsageWindow {
  /** Inclusive UTC start of the rollup window. */
  start: Date;
  /** Exclusive UTC end of the rollup window. */
  end: Date;
}

export interface PersonalUsageSummary {
  /** Theoretical (list-price) spend — the grand total regardless of plan. */
  spentUsd: number;
  /**
   * Portion actually billed per token. Excludes bundled / non-billable spend
   * (e.g. a Claude Max session), so it reflects real money out the door. The
   * bundled portion is `spentUsd - billedUsd`.
   */
  billedUsd: number;
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

export interface PersonalUsageCategoryBreakdown {
  /** Wire taxonomy value (ADR-033 CATEGORY_ENUM) — the stable key for labels. */
  category: Category;
  /** Cost attributed to this content category over the window. */
  costUsd: number;
  /** Tokens attributed to this content category over the window. */
  tokens: number;
}

export interface PersonalUsageQueryInput {
  personalProjectId: string;
  /** Defaults to start-of-current-month → now if omitted. */
  window?: PersonalUsageWindow;
  /**
   * Owner's userId. When supplied alongside `ingestionTenantId`, the
   * service unions in any gateway_budget_ledger_events written under
   * PRINCIPAL scope for this user — picks up Claude Code OTLP / other
   * ingestion-source traffic that lands under the hidden Governance
   * Project tenant rather than the user's personal-project tenant.
   * Without it, summaries / buckets / breakdowns reflect only gateway-VK
   * traffic.
   */
  userId?: string;
  /**
   * Owner's principal EMAIL. Used only by `breakdownByCategory` to
   * attribute ingestion-source traffic on the org's Governance Project
   * trace summaries: those rows carry the acting user on
   * `Attributes['langwatch.user_id']` (an email, per GOVERNANCE_ATTR.USER_ID),
   * so the category union filters on it. Distinct from `userId`, which keys
   * the gateway_budget_ledger PRINCIPAL paths (summary / buckets / models).
   * Requires `ingestionTenantId` to take effect; omitted → no category union.
   */
  userEmail?: string;
  /**
   * The org's hidden Governance Project tenant id. Ingestion-source
   * ledger rows are written under THIS tenant (ingestionRoutes.ts writes
   * `TenantId: govProject.id`), never the personal project. It is the
   * mandatory tenant scope for the PRINCIPAL-ledger union:
   *   - Correctness: a user in multiple orgs has PRINCIPAL rows under
   *     each org's governance tenant. Filtering on this org's tenant
   *     keeps /me scoped to the right org instead of summing the user's
   *     spend across every org they belong to.
   *   - Performance: `TenantId` is the leading ORDER BY key on
   *     gateway_budget_ledger_events, so this lets ClickHouse prune to
   *     the tenant's parts instead of scanning every tenant's ledger.
   * Omitted → the union is skipped entirely (an org with no Governance
   * Project has no ingestion traffic, and an unbounded cross-tenant scan
   * is never the right fallback).
   */
  ingestionTenantId?: string;
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
 * Personal-usage queries pin TenantId=<org's hidden Governance Project>
 * AND Scope='principal' (lowercase, matching `scopeToClickHouse` in
 * budget.clickhouse.repository.ts:539) AND ScopeId=userId so we get
 * exactly the per-user ledger rows for THIS org. The TenantId pin both
 * prunes partitions (it is the leading ORDER BY key) and scopes a
 * multi-org user to the current org — without it the query would sum the
 * user's principal spend across every org they belong to. Multi-budget
 * events show up multiple times across scope rows (one row per applicable
 * budget), but the Scope/ScopeId pair narrows to the user's principal
 * slice cleanly.
 */

export class PersonalUsageService {
  /**
   * Returns aggregated spend + token + model summary for the window.
   * Empty state safe — returns zeros + null model if no traces.
   */
  async summary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary> {
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
    const ingestion =
      input.userId && input.ingestionTenantId
        ? await this.queryIngestionPrincipalSummary(client, {
            tenantId: input.ingestionTenantId,
            userId: input.userId,
            window,
          })
        : null;

    const totalCost = summaryRow.totalCost + (ingestion?.totalCost ?? 0);
    // The gateway ledger records real per-token spend (virtual-key traffic the
    // customer pays for), so its whole amount is billed; the trace_summaries
    // path already nets out the non-billable (bundled) portion.
    const totalBilled = summaryRow.billedCost + (ingestion?.totalCost ?? 0);
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
      (!mergedTopModel || ingestion.topModel.requests > mergedTopModel.requests)
    ) {
      mergedTopModel = ingestion.topModel;
    }

    return {
      spentUsd: totalCost,
      billedUsd: totalBilled,
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
  async dailyBuckets(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageBucket[]> {
    const window = input.window ?? defaultLast14DaysWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return fillEmptyBuckets(window);

    const result = await client.query({
      query: `
        SELECT
          toDate(LatestOccurredAt) AS Day,
          sum(TraceSpentUsd)       AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count()                  AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
            argMax(TotalCost, UpdatedAt)  AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
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
    if (input.userId && input.ingestionTenantId) {
      const ledgerBuckets = await this.queryIngestionPrincipalBuckets(client, {
        tenantId: input.ingestionTenantId,
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
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
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
          WHERE TenantId = {tenantId:String}
            AND Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Day
          ORDER BY Day
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          tenantId: params.tenantId,
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
          sum(TraceSpentUsd) AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count()       AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt)         AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
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
    if (input.userId && input.ingestionTenantId) {
      const ledgerBreakdown = await this.queryIngestionPrincipalBreakdown(
        client,
        { tenantId: input.ingestionTenantId, userId: input.userId, window },
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

  /**
   * Per-content-category cost + token breakdown (ADR-033 PR D). Powers the
   * "Usage breakdown" lanes on /me. Category totals ride the reserved
   * `langwatch.reserved.blockcat.<category>.{cost_usd,tokens}` attributes the
   * trace fold accumulates onto trace_summaries, so this reads the personal
   * project tenant directly — the same dedup-per-trace pattern as the sibling
   * spend queries (argMax by UpdatedAt) so a replayed/re-folded trace counts
   * once. Analytics only: these numbers never feed billing (ADR-033 invariant).
   *
   * Categories with zero cost AND zero tokens are dropped, so an all-zero
   * result is an empty array — the /me view reads that as "nothing captured"
   * and renders the payload-capture enablement hint.
   *
   * Ingestion-source union: unlike the gateway_budget_ledger (which carries no
   * per-category split), the org's Governance Project trace summaries DO carry
   * the blockcat attrs plus per-user attribution on
   * `Attributes['langwatch.user_id']` (the principal EMAIL). So when
   * `userEmail` + `ingestionTenantId` are supplied, a second query over that
   * gov tenant — filtered to this user's rows — is unioned in, picking up
   * coding-agent traffic that lands under the governance tenant rather than the
   * personal project. That union degrades to no-union on failure so a CH hiccup
   * never blanks the personal rows.
   */
  async breakdownByCategory(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageCategoryBreakdown[]> {
    const window = input.window ?? defaultMonthWindow();
    const client = await getClickHouseClientForProject(input.personalProjectId);
    if (!client) return [];

    // Personal-tenant totals. Left un-guarded on purpose: a throw here is a real
    // query regression the integration test must catch, not a degrade path.
    const totals = await this.queryCategoryTotals(client, {
      tenantId: input.personalProjectId,
      window,
    });

    // Ingestion-source union over the gov tenant, scoped to this principal's
    // rows via the user_id (email) attribute. Best-effort: on failure keep the
    // personal rows rather than surfacing a 500 for an analytics-only view.
    if (input.userEmail && input.ingestionTenantId) {
      try {
        const ingestion = await this.queryCategoryTotals(client, {
          tenantId: input.ingestionTenantId,
          window,
          userEmail: input.userEmail,
        });
        for (const [category, v] of ingestion) {
          const existing = totals.get(category) ?? { costUsd: 0, tokens: 0 };
          existing.costUsd += v.costUsd;
          existing.tokens += v.tokens;
          totals.set(category, existing);
        }
      } catch (error) {
        // no-union: `totals` already holds the personal-tenant rows. Warn so a
        // silently-degraded category breakdown is diagnosable rather than
        // looking like the user simply has no ingestion-source traffic.
        logger.warn(
          {
            error,
            personalProjectId: input.personalProjectId,
            ingestionTenantId: input.ingestionTenantId,
          },
          "personal-usage category ingestion union failed; returning personal-tenant rows only",
        );
      }
    }

    const breakdown: PersonalUsageCategoryBreakdown[] = [];
    for (const category of CATEGORIES) {
      const v = totals.get(category);
      if (!v) continue;
      if (v.costUsd <= 0 && v.tokens <= 0) continue;
      breakdown.push({ category, costUsd: v.costUsd, tokens: v.tokens });
    }
    return breakdown.sort((a, b) => b.costUsd - a.costUsd);
  }

  /**
   * One category-totals query over a single tenant's trace summaries, summing
   * the reserved blockcat attributes across the window. Uses the compliant
   * IN-tuple dedup shape (same as the org Activity Monitor variant): the inner
   * subquery reads only the light dedup keys (`TenantId, TraceId, max(UpdatedAt)`),
   * and the outer query sums the heavy `Attributes[...]` map only for the
   * surviving latest-version rows — never materialising the Attributes blob (now
   * carrying the session_steps series) inside the dedup subquery. Returns every
   * category (including zeros) keyed by enum value; the caller merges, filters
   * zeros, and sorts.
   *
   * `userEmail` (ingestion-source union only): the principal-attribution filter
   * `Attributes['langwatch.user_id'] = {userEmail}` is applied in BOTH the outer
   * WHERE and the dedup subquery so the row set is scoped to this user before
   * dedup and again on the summed rows.
   *
   * Resource-guarded like the org variant (`max_threads`/`max_execution_time`
   * merged with the analytics external-group-by spill) — the per-category
   * sum-over-attributes shape has OOM'd ClickHouse before.
   */
  private async queryCategoryTotals(
    client: ClickHouseClient,
    params: {
      tenantId: string;
      window: PersonalUsageWindow;
      userEmail?: string;
    },
  ): Promise<Map<Category, { costUsd: number; tokens: number }>> {
    const outer = CATEGORIES.map(
      (_category, i) =>
        `sum(toFloat64OrZero(ts.Attributes[{c${i}:String}])) AS scost_${i},\n` +
        `sum(toFloat64OrZero(ts.Attributes[{k${i}:String}])) AS stok_${i}`,
    ).join(",\n");

    const query_params: Record<string, string | number> = {
      tenantId: params.tenantId,
      fromMs: params.window.start.getTime(),
      toMs: params.window.end.getTime(),
    };
    CATEGORIES.forEach((category, i) => {
      query_params[`c${i}`] = blockCategoryCostAttr(category);
      query_params[`k${i}`] = blockCategoryTokensAttr(category);
    });

    // The principal filter must scope BOTH the summed rows (outer, ts-aliased)
    // and the dedup key set (inner subquery, unaliased single table).
    //
    // userEmail is set ONLY on the governance-tenant union (see docstring), and
    // that tenant carries traffic from other origins too. Scope to the
    // ingestion-source origin the same way every other governance-tenant reader
    // does (activityMonitor.categoryBreakdown, the KPI/OCSF reactors) — without
    // it a principal's personal breakdown would sum non-ingestion rows.
    const outerUserFilter = params.userEmail
      ? "AND ts.Attributes[{userKey:String}] = {userEmail:String}" +
        " AND ts.Attributes[{originKey:String}] = {originValue:String}"
      : "";
    const innerUserFilter = params.userEmail
      ? "AND Attributes[{userKey:String}] = {userEmail:String}" +
        " AND Attributes[{originKey:String}] = {originValue:String}"
      : "";
    if (params.userEmail) {
      query_params.userKey = GOVERNANCE_ATTR.USER_ID;
      query_params.userEmail = params.userEmail;
      query_params.originKey = GOVERNANCE_ATTR.ORIGIN_KIND;
      query_params.originValue = GOVERNANCE_ORIGIN_KIND_VALUE;
    }

    const result = await client.query({
      query: `
        SELECT
          ${outer}
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
          AND ts.OccurredAt <  {toMs:DateTime64(3, 'UTC')}
          ${outerUserFilter}
          AND (ts.TenantId, ts.TraceId, ts.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
              AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
              ${innerUserFilter}
            GROUP BY TenantId, TraceId
          )
        SETTINGS max_threads = 2, max_execution_time = 45, ${formatSettings(
          ANALYTICS_CLICKHOUSE_SETTINGS,
        )}
      `,
      query_params,
      format: "JSONEachRow",
    });

    const [row] = (await result.json()) as Array<Record<string, number | null>>;
    const totals = new Map<Category, { costUsd: number; tokens: number }>();
    if (!row) return totals;
    CATEGORIES.forEach((category, i) => {
      totals.set(category, {
        costUsd: Number(row[`scost_${i}`]) || 0,
        tokens: Number(row[`stok_${i}`]) || 0,
      });
    });
    return totals;
  }

  private async queryIngestionPrincipalBreakdown(
    client: ClickHouseClient,
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
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
          WHERE TenantId = {tenantId:String}
            AND Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Label
          ORDER BY SpentUsd DESC
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          tenantId: params.tenantId,
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
    billedCost: number;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
  }> {
    const result = await client.query({
      query: `
        SELECT
          sum(SpentUsd)        AS TotalCost,
          sum(coalesce(SpentUsd, 0) - NonBilledUsd) AS BilledCost,
          countDistinct(TraceId) AS RequestCount,
          sum(PromptTokens)    AS PromptTokens,
          sum(CompletionTokens) AS CompletionTokens
        FROM (
          SELECT
            TraceId,
            argMax(TotalCost, UpdatedAt)               AS SpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd,
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
      BilledCost: number | null;
      RequestCount: number | null;
      PromptTokens: number | null;
      CompletionTokens: number | null;
    };
    const [row] = (await result.json()) as RawSummary[];
    if (!row) {
      return {
        totalCost: 0,
        billedCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
    }
    return {
      totalCost: Number(row.TotalCost) || 0,
      billedCost: Number(row.BilledCost) || 0,
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
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
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
          WHERE TenantId = {tenantId:String}
            AND Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          tenantId: params.tenantId,
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
          WHERE TenantId = {tenantId:String}
            AND Scope = 'principal'
            AND ScopeId = {userId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY Model
          ORDER BY Requests DESC
          LIMIT 1
          SETTINGS ${formatSettings(ANALYTICS_CLICKHOUSE_SETTINGS)}
        `,
        query_params: {
          tenantId: params.tenantId,
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
    billedUsd: 0,
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
