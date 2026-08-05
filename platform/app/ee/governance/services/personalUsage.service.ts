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
 * The dashboard reads the same shape regardless of whether the user
 * has 0 or 10k traces — we surface clear empty-state so the UI can
 * render "no usage yet" cards without special-case branching.
 *
 * The queries themselves live in {@link PersonalUsageClickHouseRepository}
 * — this service owns the merge-two-sources business logic (trace_summaries
 * vs the gateway ledger's PRINCIPAL rows) and the fail-safe behaviour: the
 * ingestion-ledger union is best-effort and degrades to "no ingestion data"
 * on any query error, same as it always has.
 */
import type {
  PersonalUsageClickHouseRepository,
  PersonalUsageWindow,
} from "./personalUsage.clickhouse.repository";

export type { PersonalUsageWindow } from "./personalUsage.clickhouse.repository";

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

export class PersonalUsageService {
  constructor(
    /**
     * The personal-usage reader, from the App. `undefined` on a
     * deployment without ClickHouse — every method degrades to its
     * empty-state shape, same as the pre-repository "no client" fallback.
     */
    private readonly repository: PersonalUsageClickHouseRepository | undefined,
  ) {}

  static create(
    repository: PersonalUsageClickHouseRepository | undefined,
  ): PersonalUsageService {
    return new PersonalUsageService(repository);
  }

  /**
   * Returns aggregated spend + token + model summary for the window.
   * Empty state safe — returns zeros + null model if no traces.
   */
  async summary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary> {
    const window = input.window ?? defaultMonthWindow();
    if (!this.repository) return emptySummary();
    const repository = this.repository;

    const summaryRow = await repository.findSummary({
      tenantId: input.personalProjectId,
      window,
    });
    const topModel = await repository.findTopModel({
      tenantId: input.personalProjectId,
      window,
    });

    // Ingestion-source events (Claude Code OTLP, etc.) land under the
    // hidden governance project tenant, NOT the user's personal
    // project — so the trace_summaries query above misses them. Pull
    // per-principal ledger rows and merge.
    const ingestion =
      input.userId && input.ingestionTenantId
        ? await this.queryIngestionPrincipalSummary(repository, {
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
    if (!this.repository) return fillEmptyBuckets(window);
    const repository = this.repository;

    const rows = await repository.findDailyBuckets({
      tenantId: input.personalProjectId,
      window,
    });

    const byDay = new Map<
      string,
      { spentUsd: number; billedUsd: number; requests: number }
    >();
    for (const r of rows) {
      byDay.set(r.day, {
        spentUsd: r.spentUsd,
        billedUsd: r.billedUsd,
        requests: r.requests,
      });
    }

    // Ingestion-source ledger union: per-day spend for the user's
    // PRINCIPAL-scope rows, merged into the same byDay map.
    if (input.userId && input.ingestionTenantId) {
      const ledgerBuckets = await this.queryIngestionPrincipalBuckets(
        repository,
        { tenantId: input.ingestionTenantId, userId: input.userId, window },
      );
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
    repository: PersonalUsageClickHouseRepository,
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
  ): Promise<PersonalUsageBucket[]> {
    try {
      return await repository.findIngestionPrincipalBuckets(params);
    } catch {
      return [];
    }
  }

  /**
   * Per-model spend breakdown. Powers the "By tool" / "By model"
   * card on /me. Models come from `trace_summaries.Models` (an array
   * — the repository explodes it via arrayJoin after the per-trace
   * argMax dedup).
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
    if (!this.repository) return [];
    const repository = this.repository;

    const rows = await repository.findModelBreakdown({
      tenantId: input.personalProjectId,
      window,
      limit,
    });

    const aggregated = new Map<string, PersonalUsageBreakdown>();
    for (const r of rows) {
      aggregated.set(r.label, {
        label: r.label,
        spentUsd: r.spentUsd,
        billedUsd: r.billedUsd,
        requests: r.requests,
      });
    }

    // Ingestion-source ledger union: per-model spend for the user's
    // PRINCIPAL-scope rows, merged into the same map.
    if (input.userId && input.ingestionTenantId) {
      const ledgerBreakdown = await this.queryIngestionPrincipalBreakdown(
        repository,
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

  private async queryIngestionPrincipalBreakdown(
    repository: PersonalUsageClickHouseRepository,
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
  ): Promise<PersonalUsageBreakdown[]> {
    try {
      return await repository.findIngestionPrincipalBreakdown(params);
    } catch {
      return [];
    }
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
   */
  private async queryIngestionPrincipalSummary(
    repository: PersonalUsageClickHouseRepository,
    params: { tenantId: string; userId: string; window: PersonalUsageWindow },
  ): Promise<{
    totalCost: number;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    topModel: { name: string; requests: number } | null;
  } | null> {
    try {
      return await repository.findIngestionPrincipalSummary(params);
    } catch {
      // CH unavailable / table not provisioned. Personal usage
      // queries already render zeros gracefully when the trace path
      // misses; do the same for the ingestion-ledger union.
      return null;
    }
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
