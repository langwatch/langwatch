/**
 * Aggregate read-side queries over the GatewayBudgetLedger. Groups spend by
 * scope, time bucket, and principal so the /gateway/usage UI can render
 * governance-grade reporting without pushing raw rows to the browser.
 *
 * These queries are read-only and take a time window. They do NOT consult
 * the budget table's current `spentUsd` — that column is the point-in-time
 * remaining-budget cache, not historical spend. Historical spend always
 * comes from the ledger.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

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
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): GatewayUsageService {
    return new GatewayUsageService(prisma);
  }

  async summary(
    projectId: string,
    window: UsageWindow,
  ): Promise<UsageSummary> {
    const virtualKeys = await this.prisma.virtualKey.findMany({
      where: { projectId },
      select: { id: true, name: true, displayPrefix: true },
    });
    const vkIds = virtualKeys.map((v) => v.id);
    if (vkIds.length === 0) {
      return emptySummary();
    }

    const ledger = await this.prisma.gatewayBudgetLedger.findMany({
      where: {
        virtualKeyId: { in: vkIds },
        occurredAt: { gte: window.fromDate, lt: window.toDate },
      },
      select: {
        virtualKeyId: true,
        amountUsd: true,
        model: true,
        status: true,
        occurredAt: true,
      },
    });

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

    for (const row of ledger) {
      totalUsd = totalUsd.plus(row.amountUsd);
      totalRequests += 1;
      if (row.status === "BLOCKED_BY_GUARDRAIL") blockedRequests += 1;

      bumpBucket(byVk, row.virtualKeyId, row.amountUsd);
      bumpBucket(byModel, row.model, row.amountUsd);
      const day = row.occurredAt.toISOString().slice(0, 10);
      bumpBucket(byDay, day, row.amountUsd);
    }

    const vkMeta = new Map(
      virtualKeys.map((v) => [
        v.id,
        { name: v.name, displayPrefix: v.displayPrefix },
      ]),
    );

    const avgUsdPerRequest =
      totalRequests > 0
        ? totalUsd.div(totalRequests).toFixed(6)
        : "0.000000";

    return {
      totalUsd: totalUsd.toFixed(6),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest,
      byVirtualKey: [...byVk.entries()]
        .sort((a, b) => (b[1].totalUsd.gt(a[1].totalUsd) ? 1 : -1))
        .slice(0, 10)
        .map(([virtualKeyId, { totalUsd, requests }]) => ({
          virtualKeyId,
          name: vkMeta.get(virtualKeyId)?.name ?? virtualKeyId,
          displayPrefix: vkMeta.get(virtualKeyId)?.displayPrefix ?? "",
          totalUsd: totalUsd.toFixed(6),
          requests,
        })),
      byModel: [...byModel.entries()]
        .sort((a, b) => (b[1].totalUsd.gt(a[1].totalUsd) ? 1 : -1))
        .slice(0, 10)
        .map(([model, { totalUsd, requests }]) => ({
          model,
          totalUsd: totalUsd.toFixed(6),
          requests,
        })),
      byDay: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, { totalUsd, requests }]) => ({
          day,
          totalUsd: totalUsd.toFixed(6),
          requests,
        })),
    };
  }

  async summaryForVirtualKey(
    projectId: string,
    virtualKeyId: string,
    window: UsageWindow,
  ): Promise<VirtualKeyUsageSummary> {
    // Guard multitenancy — only proceed if the VK belongs to the
    // given project. Matches the implicit projectId filter in
    // summary() above.
    const vk = await this.prisma.virtualKey.findFirst({
      where: { id: virtualKeyId, projectId },
      select: { id: true },
    });
    if (!vk) {
      return emptyVkSummary();
    }

    const ledger = await this.prisma.gatewayBudgetLedger.findMany({
      where: {
        virtualKeyId,
        occurredAt: { gte: window.fromDate, lt: window.toDate },
      },
      select: {
        id: true,
        amountUsd: true,
        model: true,
        providerSlot: true,
        tokensInput: true,
        tokensOutput: true,
        durationMs: true,
        status: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "desc" },
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
    let totalRequests = 0;
    let blockedRequests = 0;

    for (const row of ledger) {
      totalUsd = totalUsd.plus(row.amountUsd);
      totalRequests += 1;
      if (row.status === "BLOCKED_BY_GUARDRAIL") blockedRequests += 1;
      bumpBucket(byModel, row.model, row.amountUsd);
      const day = row.occurredAt.toISOString().slice(0, 10);
      bumpBucket(byDay, day, row.amountUsd);
    }

    const avgUsdPerRequest =
      totalRequests > 0
        ? totalUsd.div(totalRequests).toFixed(6)
        : "0.000000";

    return {
      totalUsd: totalUsd.toFixed(6),
      totalRequests,
      blockedRequests,
      avgUsdPerRequest,
      byModel: [...byModel.entries()]
        .sort((a, b) => (b[1].totalUsd.gt(a[1].totalUsd) ? 1 : -1))
        .slice(0, 10)
        .map(([model, { totalUsd, requests }]) => ({
          model,
          totalUsd: totalUsd.toFixed(6),
          requests,
        })),
      byDay: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, { totalUsd, requests }]) => ({
          day,
          totalUsd: totalUsd.toFixed(6),
          requests,
        })),
      recentDebits: ledger.slice(0, 20).map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        model: row.model,
        providerSlot: row.providerSlot,
        amountUsd: row.amountUsd.toString(),
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        durationMs: row.durationMs,
        status: row.status,
      })),
    };
  }
}

function bumpBucket(
  map: Map<string, { totalUsd: Prisma.Decimal; requests: number }>,
  key: string,
  amount: Prisma.Decimal,
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
