/**
 * Aggregate read-side queries for the AI Gateway usage surfaces.
 *
 * Spend comes from `trace_summaries`, the enriched per-trace cost the rest
 * of the product bills and reports from, keyed on the
 * `langwatch.virtual_key_id` attribute the gateway stamps on every span.
 *
 * It used to come from `gateway_budget_ledger_events`, which is written
 * once per applicable budget and not at all when a key has none. That made
 * the page structurally unable to show spend for an uncapped key ($0.00
 * forever) and made it report double or triple for a key covered by
 * several budgets. The budget ledger stays the source for the debit list
 * on a budget's own page, where "one row per budget" is the point.
 *
 * The virtual-keys table's spend column reads the same repository, because
 * a number you can click has to match the page it lands on.
 *
 * Every read spans the organization's projects, not just one: traces land
 * in the tenant of a key's trace destination (its explicit trace project,
 * else its single PROJECT scope, else the org's governance project), which
 * is rarely the project the viewer happens to have selected. Reading one
 * project is how the Usage page rendered "No usage in this window" while
 * the keys table showed spend for the same keys.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import type { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import type { GatewayVirtualKeySpendRepository } from "./virtualKeySpend.clickhouse.repository";

export type UsageWindow = { fromDate: Date; toDate: Date };

export type UsageSummary = {
  totalUsd: string;
  totalRequests: number;
  blockedRequests: number;
  avgUsdPerRequest: string;
  byVirtualKey: Array<{
    virtualKeyId: string;
    name: string;
    displayPrefix: string;
    totalUsd: string;
    requests: number;
  }>;
  byModel: Array<{
    model: string;
    totalUsd: string;
    requests: number;
  }>;
  byDay: Array<{ day: string; totalUsd: string; requests: number }>;
};

// Scoped-to-one-VK version for the detail page. Omits the per-VK
// rollup (there's only one) and exposes the 20 most recent debits.
export type VirtualKeyUsageSummary = {
  totalUsd: string;
  totalRequests: number;
  blockedRequests: number;
  avgUsdPerRequest: string;
  byModel: Array<{
    model: string;
    totalUsd: string;
    requests: number;
  }>;
  byDay: Array<{ day: string; totalUsd: string; requests: number }>;
  recentDebits: Array<{
    id: string;
    occurredAt: string;
    model: string;
    providerSlot: string | null;
    amountUsd: string;
    tokensInput: number;
    tokensOutput: number;
    durationMs: number | null;
    status: string;
  }>;
};

const RECENT_DEBITS_LIMIT = 20;

export class GatewayUsageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chRepo?: GatewayBudgetClickHouseRepository,
    private readonly spendRepo?: GatewayVirtualKeySpendRepository,
  ) {}

  /**
   * Both repos are required keys with optional values: a deploy without
   * ClickHouse passes `undefined` explicitly and gets empty summaries by
   * configuration, while a caller that forgets the dependency fails to
   * compile instead of silently reporting $0.00.
   */
  static create(args: {
    prisma: PrismaClient;
    chRepo: GatewayBudgetClickHouseRepository | undefined;
    spendRepo: GatewayVirtualKeySpendRepository | undefined;
  }): GatewayUsageService {
    return new GatewayUsageService(args.prisma, args.chRepo, args.spendRepo);
  }

  /**
   * Spend per key over a window, for every key in an organization.
   *
   * Reads across every project in the org, not just one: a key's traces
   * land in whichever project resolved as its trace destination, which for
   * org- and team-scoped keys is the governance project.
   */
  async spendByVirtualKey(args: {
    organizationId: string;
    virtualKeyIds: string[];
    window: UsageWindow;
  }): Promise<Map<string, { spentUsd: string; requests: number }>> {
    const out = new Map<string, { spentUsd: string; requests: number }>();
    if (!this.spendRepo || args.virtualKeyIds.length === 0) return out;

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) return out;

    const rows = await this.spendRepo.spendByVirtualKey({
      tenantIds,
      virtualKeyIds: args.virtualKeyIds,
      window: { fromDate: args.window.fromDate, toDate: args.window.toDate },
    });
    for (const row of rows) {
      out.set(row.virtualKeyId, {
        spentUsd: row.spentUsd,
        requests: row.requests,
      });
    }
    return out;
  }

  /**
   * The Usage page's org-wide rollup.
   *
   * `virtualKeyIds` is the caller's visible-key set, computed by the
   * router with the same membership rule the keys table applies, so the
   * page totals exactly the keys the table lists. The aggregation itself
   * happens in ClickHouse: the buckets are keys x models x days, so a
   * busy org's window never streams per-trace rows into this process.
   */
  async summary(args: {
    organizationId: string;
    virtualKeyIds: string[];
    window: UsageWindow;
  }): Promise<UsageSummary> {
    if (!this.spendRepo || args.virtualKeyIds.length === 0) {
      return emptySummary();
    }

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) return emptySummary();

    const buckets = await this.spendRepo.usageBuckets({
      tenantIds,
      window: args.window,
      virtualKeyIds: args.virtualKeyIds,
    });
    if (buckets.length === 0) return emptySummary();

    const byVk = new Map<
      string,
      { totalUsd: Prisma.Decimal; requests: number }
    >();
    const byModel = new Map<
      string,
      { totalUsd: Prisma.Decimal; requests: number }
    >();
    const byDay = new Map<
      string,
      { totalUsd: Prisma.Decimal; requests: number }
    >();
    let totalUsd = new Prisma.Decimal(0);
    let totalRequests = 0;
    let blockedRequests = 0;

    for (const bucket of buckets) {
      totalUsd = totalUsd.plus(bucket.totalUsd);
      totalRequests += bucket.requests;
      blockedRequests += bucket.blockedRequests;
      bumpBucket({
        map: byVk,
        key: bucket.virtualKeyId,
        amount: bucket.totalUsd,
        requests: bucket.requests,
      });
      bumpBucket({
        map: byModel,
        key: bucket.model,
        amount: bucket.totalUsd,
        requests: bucket.requests,
      });
      bumpBucket({
        map: byDay,
        key: bucket.day,
        amount: bucket.totalUsd,
        requests: bucket.requests,
      });
    }

    const vkMeta = await this.loadVirtualKeyMeta([...byVk.keys()]);

    return {
      totalUsd: totalUsd.toFixed(6),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest: averagePerRequest(totalUsd, totalRequests),
      byVirtualKey: topEntries(byVk).map(
        ([virtualKeyId, { totalUsd, requests }]) => ({
          virtualKeyId,
          name: vkMeta.get(virtualKeyId)?.name ?? virtualKeyId,
          displayPrefix: vkMeta.get(virtualKeyId)?.displayPrefix ?? "",
          totalUsd: totalUsd.toFixed(6),
          requests,
        }),
      ),
      byModel: topEntries(byModel).map(([model, { totalUsd, requests }]) => ({
        model,
        totalUsd: totalUsd.toFixed(6),
        requests,
      })),
      byDay: sortedDays(byDay),
    };
  }

  /**
   * One key's usage, read across the organization's projects so the total
   * matches the spend column that deep-links here. Key visibility is the
   * router's job (the same membership rule as `virtualKeys.get`); by the
   * time this runs the caller is allowed to see the key.
   */
  async summaryForVirtualKey(args: {
    organizationId: string;
    virtualKeyId: string;
    window: UsageWindow;
  }): Promise<VirtualKeyUsageSummary> {
    if (!this.spendRepo) return emptyVkSummary();

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) return emptyVkSummary();

    // Slices aggregate in ClickHouse; only the 20-row recent list pulls
    // raw traces, and that pull carries its own LIMIT.
    const [buckets, recentTraces] = await Promise.all([
      this.spendRepo.usageBuckets({
        tenantIds,
        window: args.window,
        virtualKeyIds: [args.virtualKeyId],
      }),
      this.spendRepo.gatewayTraces({
        tenantIds,
        window: args.window,
        virtualKeyIds: [args.virtualKeyId],
        limit: RECENT_DEBITS_LIMIT,
      }),
    ]);

    const { byModel, byDay, totalUsd, totalRequests, blockedRequests } =
      accumulateUsageBuckets(buckets);

    return {
      totalUsd: totalUsd.toFixed(6),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest: averagePerRequest(totalUsd, totalRequests),
      byModel: topEntries(byModel).map(([model, { totalUsd, requests }]) => ({
        model,
        totalUsd: totalUsd.toFixed(6),
        requests,
      })),
      byDay: sortedDays(byDay),
      recentDebits: recentTraces.map((trace) => ({
        id: trace.traceId,
        occurredAt: trace.occurredAt.toISOString(),
        model: trace.models[0] ?? "unknown",
        providerSlot: null,
        amountUsd: trace.costUsd,
        tokensInput: trace.promptTokens,
        tokensOutput: trace.completionTokens,
        durationMs: trace.durationMs || null,
        status: trace.blockedByGuardrail
          ? "BLOCKED_BY_GUARDRAIL"
          : trace.hasError
            ? "PROVIDER_ERROR"
            : "SUCCESS",
      })),
    };
  }

  private async loadVirtualKeyMeta(
    virtualKeyIds: string[],
  ): Promise<Map<string, { name: string; displayPrefix: string }>> {
    if (virtualKeyIds.length === 0) return new Map();
    const keys = await this.prisma.virtualKey.findMany({
      where: { id: { in: virtualKeyIds } },
      select: { id: true, name: true, displayPrefix: true },
    });
    return new Map(
      keys.map((k) => [k.id, { name: k.name, displayPrefix: k.displayPrefix }]),
    );
  }

  /** Every project of the org: the tenant set gateway traces can land in. */
  private async orgProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }
}

function averagePerRequest(totalUsd: Prisma.Decimal, requests: number): string {
  return requests > 0 ? totalUsd.div(requests).toFixed(6) : "0.000000";
}

function topEntries(
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>,
  limit = 10,
): Array<[string, { totalUsd: Prisma.Decimal; requests: number }]> {
  return [...map.entries()]
    .sort(
      (a, b) =>
        b[1].totalUsd.comparedTo(a[1].totalUsd) || a[0].localeCompare(b[0]),
    )
    .slice(0, limit);
}

function sortedDays(
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>,
): Array<{ day: string; totalUsd: string; requests: number }> {
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, { totalUsd, requests }]) => ({
      day,
      totalUsd: totalUsd.toFixed(6),
      requests,
    }));
}

/**
 * Fold usage buckets into per-model and per-day maps plus grand totals —
 * one pass, shared by the virtual-key summary.
 */
function accumulateUsageBuckets(
  buckets: Array<{
    model: string;
    day: string;
    totalUsd: Prisma.Decimal | string;
    requests: number;
    blockedRequests: number;
  }>,
) {
  const byModel = new Map<
    string,
    { totalUsd: Prisma.Decimal; requests: number }
  >();
  const byDay = new Map<
    string,
    { totalUsd: Prisma.Decimal; requests: number }
  >();
  let totalUsd = new Prisma.Decimal(0);
  let totalRequests = 0;
  let blockedRequests = 0;

  for (const bucket of buckets) {
    totalUsd = totalUsd.plus(bucket.totalUsd);
    totalRequests += bucket.requests;
    blockedRequests += bucket.blockedRequests;
    bumpBucket({
      map: byModel,
      key: bucket.model,
      amount: bucket.totalUsd,
      requests: bucket.requests,
    });
    bumpBucket({
      map: byDay,
      key: bucket.day,
      amount: bucket.totalUsd,
      requests: bucket.requests,
    });
  }

  return { byModel, byDay, totalUsd, totalRequests, blockedRequests };
}

function bumpBucket({
  map,
  key,
  amount,
  requests,
}: {
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>;
  key: string;
  amount: Prisma.Decimal | string;
  requests: number;
}) {
  const existing = map.get(key);
  if (existing) {
    existing.totalUsd = existing.totalUsd.plus(amount);
    existing.requests += requests;
  } else {
    map.set(key, { totalUsd: new Prisma.Decimal(amount), requests });
  }
}

function emptySummary(): UsageSummary {
  return {
    totalUsd: "0.000000",
    totalRequests: 0,
    blockedRequests: 0,
    avgUsdPerRequest: "0.000000",
    byVirtualKey: [],
    byModel: [],
    byDay: [],
  };
}

function emptyVkSummary(): VirtualKeyUsageSummary {
  return {
    totalUsd: "0.000000",
    totalRequests: 0,
    blockedRequests: 0,
    avgUsdPerRequest: "0.000000",
    byModel: [],
    byDay: [],
    recentDebits: [],
  };
}
