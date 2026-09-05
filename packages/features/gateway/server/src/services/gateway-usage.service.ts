/**
 * Aggregate read-side queries for AI Gateway usage surfaces. Spend comes from trace_summaries (enriched per-trace cost, keyed on langwatch.virtual_key_id), not gateway_budget_ledger_events — the ledger writes once per applicable budget and never for an uncapped key, structurally showing $0.00 forever or double/triple-counting a multi-budget key (it stays the source for a budget's own debit list, where one-row-per-budget is the point). The VK table's spend column reads the same repository so a clickable number matches its page. Every read spans the org's projects, not one, since traces land in a key's trace destination (explicit project, else PROJECT scope, else governance project) — reading one project is how Usage showed no data while the keys table showed spend.
 */
import { usdToNanoUsd } from "@langwatch/gateway-contract";

import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { GatewayVirtualKeySpendPort } from "../ports/gateway-virtual-key-spend.port";

/**
 * The one project read these surfaces make: which tenants an org's gateway traces can land in. Narrower than ProjectService on purpose — anything that can answer the question satisfies it, which is what a test needs.
 */
export type GatewayUsageProjectsPort = {
  listIdsByOrganization(input: { organizationId: string }): Promise<string[]>;
};

/**
 * The one key read these surfaces make: a label for each key the ledger
 * reported spend against. Narrow for the same reason as the project port —
 * the repository satisfies it, and so can two lines in a test.
 */
export type GatewayUsageVirtualKeysPort = {
  findMetaByIds(input: {
    organizationId: string;
    ids: string[];
  }): Promise<Array<{ id: string; name: string; displayPrefix: string }>>;
};

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
  private constructor(
    private readonly projects: GatewayUsageProjectsPort,
    private readonly virtualKeys: GatewayUsageVirtualKeysPort,
    private readonly chRepo?: GatewayBudgetSpendPort,
    private readonly spendRepo?: GatewayVirtualKeySpendPort,
  ) {}

  /**
   * Both repos are required keys with optional values: a CH-less deploy passes undefined explicitly and gets empty summaries by configuration, while a caller forgetting the dependency fails to compile instead of silently reporting $0.00.
   */
  static create(args: {
    projects: GatewayUsageProjectsPort;
    virtualKeys: GatewayUsageVirtualKeysPort;
    chRepo: GatewayBudgetSpendPort | undefined;
    spendRepo: GatewayVirtualKeySpendPort | undefined;
  }): GatewayUsageService {
    return new GatewayUsageService(args.projects, args.virtualKeys, args.chRepo, args.spendRepo);
  }

  /**
   * Spend per key over a window, for every key in an org — reads across every project, not one, since a key's traces land in whichever project resolved as its trace destination (governance project for org/team-scoped keys).
   */
  async spendByVirtualKey(args: {
    organizationId: string;
    virtualKeyIds: string[];
    window: UsageWindow;
  }): Promise<Map<string, { spentUsd: string; requests: number }>> {
    const out = new Map<string, { spentUsd: string; requests: number }>();
    if (!this.spendRepo || args.virtualKeyIds.length === 0) {
      return out;
    }

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) {
      return out;
    }

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
   * The Usage page's org-wide rollup. virtualKeyIds is the caller's visible-key set, computed by the router with the same membership rule the keys table applies, so the page totals exactly the keys listed. Aggregation happens in ClickHouse (keys x models x days buckets), so a busy org's window never streams per-trace rows into this process.
   */
  async summary(args: {
    organizationId: string;
    virtualKeyIds: string[];
    window: UsageWindow;
  }): Promise<UsageSummary> {
    if (!this.spendRepo || args.virtualKeyIds.length === 0) {
      return this.emptySummary();
    }

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) {
      return this.emptySummary();
    }

    const buckets = await this.spendRepo.usageBuckets({
      tenantIds,
      window: args.window,
      virtualKeyIds: args.virtualKeyIds,
    });
    if (buckets.length === 0) {
      return this.emptySummary();
    }

    const byVk = new Map<string, { totalUsd: bigint; requests: number }>();
    const byModel = new Map<string, { totalUsd: bigint; requests: number }>();
    const byDay = new Map<string, { totalUsd: bigint; requests: number }>();
    let totalUsd = 0n;
    let totalRequests = 0;
    let blockedRequests = 0;

    for (const bucket of buckets) {
      totalUsd += usdToNanoUsd(bucket.totalUsd);
      totalRequests += bucket.requests;
      blockedRequests += bucket.blockedRequests;
      this.bumpBucket(byVk, bucket.virtualKeyId, bucket.totalUsd, bucket.requests);
      this.bumpBucket(byModel, bucket.model, bucket.totalUsd, bucket.requests);
      this.bumpBucket(byDay, bucket.day, bucket.totalUsd, bucket.requests);
    }

    const vkMeta = await this.loadVirtualKeyMeta(args.organizationId, [...byVk.keys()]);

    return {
      totalUsd: nanoUsdToFixed6(totalUsd),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest: this.averagePerRequest(totalUsd, totalRequests),
      byVirtualKey: this.topEntries(byVk).map(
        ([virtualKeyId, { totalUsd: bucketUsd, requests }]) => ({
          virtualKeyId,
          name: vkMeta.get(virtualKeyId)?.name ?? virtualKeyId,
          displayPrefix: vkMeta.get(virtualKeyId)?.displayPrefix ?? "",
          totalUsd: nanoUsdToFixed6(bucketUsd),
          requests,
        }),
      ),
      byModel: this.topEntries(byModel).map(([model, { totalUsd: bucketUsd, requests }]) => ({
        model,
        totalUsd: nanoUsdToFixed6(bucketUsd),
        requests,
      })),
      byDay: this.sortedDays(byDay),
    };
  }

  /**
   * One key's usage, read across the org's projects so the total matches the spend column that deep-links here. Key visibility is the router's job (same membership rule as virtualKeys.get); by the time this runs the caller may already see the key.
   */
  async summaryForVirtualKey(args: {
    organizationId: string;
    virtualKeyId: string;
    window: UsageWindow;
    /**
     * Narrows the recent-activity list to one model, and only that list — totals, daily series and per-model breakdown stay whole, since the breakdown is the control the model is picked from and filtering it too would leave no way back.
     */
    model?: string;
  }): Promise<VirtualKeyUsageSummary> {
    if (!this.spendRepo) {
      return this.emptyVirtualKeySummary();
    }

    const tenantIds = await this.orgProjectIds(args.organizationId);
    if (tenantIds.length === 0) {
      return this.emptyVirtualKeySummary();
    }

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
        model: args.model,
        limit: RECENT_DEBITS_LIMIT,
      }),
    ]);

    const byModel = new Map<string, { totalUsd: bigint; requests: number }>();
    const byDay = new Map<string, { totalUsd: bigint; requests: number }>();
    let totalUsd = 0n;
    let totalRequests = 0;
    let blockedRequests = 0;

    for (const bucket of buckets) {
      totalUsd += usdToNanoUsd(bucket.totalUsd);
      totalRequests += bucket.requests;
      blockedRequests += bucket.blockedRequests;
      this.bumpBucket(byModel, bucket.model, bucket.totalUsd, bucket.requests);
      this.bumpBucket(byDay, bucket.day, bucket.totalUsd, bucket.requests);
    }

    return {
      totalUsd: nanoUsdToFixed6(totalUsd),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest: this.averagePerRequest(totalUsd, totalRequests),
      byModel: this.topEntries(byModel).map(([model, { totalUsd: bucketUsd, requests }]) => ({
        model,
        totalUsd: nanoUsdToFixed6(bucketUsd),
        requests,
      })),
      byDay: this.sortedDays(byDay),
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
    organizationId: string,
    virtualKeyIds: string[],
  ): Promise<Map<string, { name: string; displayPrefix: string }>> {
    const keys = await this.virtualKeys.findMetaByIds({ organizationId, ids: virtualKeyIds });

    return new Map(keys.map((k) => [k.id, { name: k.name, displayPrefix: k.displayPrefix }]));
  }

  /** Every project of the org: the tenant set gateway traces can land in. */
  private orgProjectIds(organizationId: string): Promise<string[]> {
    return this.projects.listIdsByOrganization({ organizationId });
  }

  private averagePerRequest(totalUsd: bigint, requests: number): string {
    return requests > 0
      ? microUsdToFixed6(roundedQuotient(totalUsd, 1000n * BigInt(requests)))
      : "0.000000";
  }

  private topEntries(
    map: Map<string, { totalUsd: bigint; requests: number }>,
    limit = 10,
  ): Array<[string, { totalUsd: bigint; requests: number }]> {
    return [...map.entries()]
      .sort((a, b) => compareBigInt(b[1].totalUsd, a[1].totalUsd) || a[0].localeCompare(b[0]))
      .slice(0, limit);
  }

  private sortedDays(
    map: Map<string, { totalUsd: bigint; requests: number }>,
  ): Array<{ day: string; totalUsd: string; requests: number }> {
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, { totalUsd, requests }]) => ({
        day,
        totalUsd: nanoUsdToFixed6(totalUsd),
        requests,
      }));
  }

  private bumpBucket(
    map: Map<string, { totalUsd: bigint; requests: number }>,
    key: string,
    amount: string,
    requests: number,
  ) {
    const existing = map.get(key);
    if (existing) {
      existing.totalUsd += usdToNanoUsd(amount);
      existing.requests += requests;
    } else {
      map.set(key, { totalUsd: usdToNanoUsd(amount), requests });
    }
  }

  private emptySummary(): UsageSummary {
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

  private emptyVirtualKeySummary(): VirtualKeyUsageSummary {
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
}

/** Descending-friendly comparison of two nano-USD integers. */
function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/** Half-away-from-zero division, the rounding a money display string promises. */
function roundedQuotient(value: bigint, divisor: bigint): bigint {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude * 2n + divisor) / (2n * divisor);
  return negative ? -rounded : rounded;
}

/** A micro-USD integer as a six-decimal money string. */
function microUsdToFixed6(micro: bigint): string {
  const negative = micro < 0n;
  const magnitude = negative ? -micro : micro;
  const fraction = (magnitude % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${magnitude / 1_000_000n}.${fraction}`;
}

/** A nano-USD integer as a six-decimal money string. */
function nanoUsdToFixed6(nano: bigint): string {
  return microUsdToFixed6(roundedQuotient(nano, 1000n));
}
