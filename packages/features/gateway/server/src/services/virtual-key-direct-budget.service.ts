/**
 * The budget a key carries on itself, with spend in its own current period — distinct from calendar-month spend (a daily cap measures against today, so $2.50/month spent can still be $0.50 of a $1.00 day, both true, neither substituting). Spend comes from the same rollup read the drawer's "already applies" list and Budgets page use, so a limit and its "spent so far" agree everywhere.
 */
import type { GatewayBudget, PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";
import { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import { GatewayWindow } from "@langwatch/gateway-contract";

const logger = createLogger("langwatch:gateway:virtual-key-direct-budget");

export type VirtualKeyDirectBudget = {
  budgetId: string;
  window: GatewayBudget["window"];
  limitUsd: string;
  /** Null when the rollup could not be read: unknown, not zero. */
  periodSpentUsd: string | null;
  /** End of the period the spend is measured over, ISO-8601. */
  resetsAt: string;
};

/**
 * One budget per key, from the rows that target them. A key can carry more than one cap (drawer-managed plus independently created on the Budgets page); the drawer's row is what the key's own field controls and reports, otherwise the oldest wins for stable rendering.
 */
function chooseOnePerKey(
  budgets: GatewayBudget[],
  visibleKeyIds: Set<string>,
): Map<string, GatewayBudget> {
  const chosen = new Map<string, GatewayBudget>();
  for (const budget of budgets) {
    const keyId = keyThisBudgetBelongsTo(budget, visibleKeyIds);
    if (!keyId) {
      continue;
    }

    if (winsOver(budget, chosen.get(keyId))) {
      chosen.set(keyId, budget);
    }
  }

  return chosen;
}

/**
 * Visible key a budget row reports against, or null if none. The budget's scope target wins when the caller can see it; a drawer-managed row whose target is outside the visible set still belongs to the key managing it, so that key is the fallback rather than dropping the row.
 */
function keyThisBudgetBelongsTo(budget: GatewayBudget, visibleKeyIds: Set<string>): string | null {
  const scoped = budget.scopeType === "VIRTUAL_KEY" ? budget.scopeId : null;
  if (scoped && visibleKeyIds.has(scoped)) {
    return scoped;
  }

  const managed = budget.managedByVirtualKeyId;

  return managed && visibleKeyIds.has(managed) ? managed : null;
}

/** First row seen wins, except that a drawer-managed row displaces one that is not. */
function winsOver(candidate: GatewayBudget, incumbent: GatewayBudget | undefined): boolean {
  if (!incumbent) {
    return true;
  }

  return !incumbent.managedByVirtualKeyId && !!candidate.managedByVirtualKeyId;
}

/**
 * Current-period spend for every chosen budget in one read. Null means
 * the rollup could not be totalled, which the bar renders as an unknown
 * rather than as a confident zero.
 */
async function loadPeriodSpend(args: {
  prisma: PrismaClient;
  organizationId: string;
  budgets: GatewayBudget[];
  chRepo: GatewayBudgetSpendPort | undefined;
  now: Date;
}): Promise<Map<string, string> | null> {
  const { prisma, organizationId, budgets, chRepo, now } = args;
  if (!chRepo) {
    return null;
  }

  // ORG/TEAM/PRINCIPAL rows accrue under whichever project emitted the
  // trace, so every project in the organization is a tenant to sum over.
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  try {
    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      projects.map((p) => p.id),
      GatewayBudgetSpendPort.targetsForBudgets({ budgets, now }),
      now,
    );

    return new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
  } catch (error) {
    // The bar degrades to "unknown" either way, but a broken rollup read
    // and an expected gap must not look the same to whoever is on call.
    logger.error(
      {
        error,
        organizationId,
        budgetIds: budgets.map((b) => b.id),
      },
      "the direct-budget spend rollup could not be read; the bar degrades to unknown",
    );

    return null;
  }
}

/** The budget a key carries on itself, with its current-period spend. */
export class VirtualKeyDirectBudgetService {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): VirtualKeyDirectBudgetService {
    return new VirtualKeyDirectBudgetService(prisma);
  }

  /**
   * Resolve one direct budget per key, keyed by VK id — keys with none are absent. "Direct" means the key's own row: a VIRTUAL_KEY-scoped budget targeting it, or the row its drawer's field manages. Budgets reached via org/team/project/account are not the key's own cap and belong to the drawer's inherited list.
   */
  async loadDirectBudgetsForKeys(args: {
    organizationId: string;
    virtualKeyIds: string[];
    chRepo: GatewayBudgetSpendPort | undefined;
    /**
     * The instant the periods are computed from. Injectable so a test that
     * wrote a debit at a known time reads the same period back instead of
     * racing the wall clock across a midnight boundary.
     */
    now?: Date;
  }): Promise<Map<string, VirtualKeyDirectBudget>> {
    const { chRepo, now = new Date() } = args;
    const prisma = this.prisma;
    const out = new Map<string, VirtualKeyDirectBudget>();
    if (args.virtualKeyIds.length === 0) {
      return out;
    }

    const budgets = await prisma.gatewayBudget.findMany({
      where: {
        organizationId: args.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "VIRTUAL_KEY", scopeId: { in: args.virtualKeyIds } },
          { managedByVirtualKeyId: { in: args.virtualKeyIds } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    const chosen = chooseOnePerKey(budgets, new Set(args.virtualKeyIds));
    if (chosen.size === 0) {
      return out;
    }

    const spentByBudgetId = await loadPeriodSpend({
      prisma,
      organizationId: args.organizationId,
      budgets: [...chosen.values()],
      chRepo,
      now,
    });

    for (const [virtualKeyId, budget] of chosen) {
      out.set(virtualKeyId, {
        budgetId: budget.id,
        window: budget.window,
        limitUsd: budget.limitUsd.toFixed(6),
        periodSpentUsd: spentByBudgetId ? (spentByBudgetId.get(budget.id) ?? "0") : null,
        // Recomputed from the window rather than read off the row: the
        // stored instant is only rewritten when the window changes, so a
        // budget that has been running for days carries a reset moment
        // that has already passed.
        resetsAt: GatewayWindow.nextResetAt(budget.window, now).toISOString(),
      });
    }

    return out;
  }
}
