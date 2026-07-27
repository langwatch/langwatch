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

export class GatewayUsageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chRepo?: GatewayBudgetClickHouseRepository,
    private readonly spendRepo?: GatewayVirtualKeySpendRepository,
  ) {}

  static create(
    prisma: PrismaClient,
    chRepo?: GatewayBudgetClickHouseRepository,
    spendRepo?: GatewayVirtualKeySpendRepository,
  ): GatewayUsageService {
    return new GatewayUsageService(prisma, chRepo, spendRepo);
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

    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId: args.organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return out;

    const rows = await this.spendRepo.spendByVirtualKey({
      tenantIds: projects.map((p) => p.id),
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

  async summary(projectId: string, window: UsageWindow): Promise<UsageSummary> {
    if (!this.spendRepo) return emptySummary();

    // No VirtualKey predicate: the traces themselves say which key spent
    // in this project. Filtering by "keys with a PROJECT scope row here"
    // is what hid org- and team-scoped keys, whose traffic lands in this
    // project's ledger all the same.
    const traces = await this.spendRepo.gatewayTraces({
      tenantIds: [projectId],
      window,
    });
    if (traces.length === 0) return emptySummary();

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
    let blockedRequests = 0;

    for (const trace of traces) {
      totalUsd = totalUsd.plus(trace.costUsd);
      if (trace.blockedByGuardrail) blockedRequests += 1;
      bumpBucket(byVk, trace.virtualKeyId, trace.costUsd);
      bumpBucket(byModel, trace.models[0] ?? "unknown", trace.costUsd);
      bumpBucket(byDay, utcDay(trace.occurredAt), trace.costUsd);
    }

    const vkMeta = await this.loadVirtualKeyMeta([...byVk.keys()]);
    const totalRequests = traces.length;

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

  async summaryForVirtualKey(
    projectId: string,
    virtualKeyId: string,
    window: UsageWindow,
  ): Promise<VirtualKeyUsageSummary> {
    if (!this.spendRepo) return emptyVkSummary();

    // Tenancy: only a key the project can actually see. A key is visible
    // to a project when it is scoped there, or when it is scoped wider
    // (team / org) over that project: the same reach that decides where
    // its traces land.
    const visible = await this.isVirtualKeyVisibleToProject(
      projectId,
      virtualKeyId,
    );
    if (!visible) return emptyVkSummary();

    const traces = await this.spendRepo.gatewayTraces({
      tenantIds: [projectId],
      window,
      virtualKeyIds: [virtualKeyId],
    });

    const byModel = new Map<
      string,
      { totalUsd: Prisma.Decimal; requests: number }
    >();
    const byDay = new Map<
      string,
      { totalUsd: Prisma.Decimal; requests: number }
    >();
    let totalUsd = new Prisma.Decimal(0);
    let blockedRequests = 0;

    for (const trace of traces) {
      totalUsd = totalUsd.plus(trace.costUsd);
      if (trace.blockedByGuardrail) blockedRequests += 1;
      bumpBucket(byModel, trace.models[0] ?? "unknown", trace.costUsd);
      bumpBucket(byDay, utcDay(trace.occurredAt), trace.costUsd);
    }

    return {
      totalUsd: totalUsd.toFixed(6),
      totalRequests: traces.length,
      blockedRequests,
      avgUsdPerRequest: averagePerRequest(totalUsd, traces.length),
      byModel: topEntries(byModel).map(([model, { totalUsd, requests }]) => ({
        model,
        totalUsd: totalUsd.toFixed(6),
        requests,
      })),
      byDay: sortedDays(byDay),
      recentDebits: traces.slice(0, 20).map((trace) => ({
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
      keys.map((k) => [
        k.id,
        { name: k.name, displayPrefix: k.displayPrefix },
      ]),
    );
  }

  private async isVirtualKeyVisibleToProject(
    projectId: string,
    virtualKeyId: string,
  ): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project?.team) return false;
    const vk = await this.prisma.virtualKey.findFirst({
      where: {
        id: virtualKeyId,
        organizationId: project.team.organizationId,
        scopes: {
          some: {
            OR: [
              { scopeType: "PROJECT", scopeId: project.id },
              { scopeType: "TEAM", scopeId: project.teamId },
              {
                scopeType: "ORGANIZATION",
                scopeId: project.team.organizationId,
              },
            ],
          },
        },
      },
      select: { id: true },
    });
    return vk !== null;
  }
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function averagePerRequest(
  totalUsd: Prisma.Decimal,
  requests: number,
): string {
  return requests > 0 ? totalUsd.div(requests).toFixed(6) : "0.000000";
}

function topEntries(
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>,
  limit = 10,
): Array<[string, { totalUsd: Prisma.Decimal; requests: number }]> {
  return [...map.entries()]
    .sort((a, b) => (b[1].totalUsd.gt(a[1].totalUsd) ? 1 : -1))
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

function bumpBucket(
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>,
  key: string,
  amount: Prisma.Decimal | string,
) {
  const existing = map.get(key);
  if (existing) {
    existing.totalUsd = existing.totalUsd.plus(amount);
    existing.requests += 1;
  } else {
    map.set(key, { totalUsd: new Prisma.Decimal(amount), requests: 1 });
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
