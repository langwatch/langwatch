/**
 * The budget a key carries on itself, with what it has spent in the
 * budget's own current period.
 *
 * Distinct from the key's calendar-month spend: a daily cap is measured
 * against today, so a key that spent $2.50 this month can still be at
 * $0.50 of its $1.00 day. Both numbers are true and neither substitutes
 * for the other, which is why the table shows the month total and the
 * period bar side by side.
 *
 * Spend comes from the same rollup read the drawer's "already applies"
 * list and the Budgets page use, with bucket-exact targets, so a limit
 * and its "spent so far" agree wherever they are shown.
 */
import type { GatewayBudget, PrismaClient } from "@prisma/client";

import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  type GatewayBudgetClickHouseRepository,
  spendTargetsForBudgets,
} from "./budget.clickhouse.repository";
import { nextResetAt } from "./budgetWindow";

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
 * Resolve one direct budget per key, keyed by virtual key id. Keys with
 * no budget of their own are absent from the map.
 *
 * "Direct" is the key's own row: a VIRTUAL_KEY-scoped budget targeting
 * it, or the row its drawer's budget field manages. Budgets that reach
 * the key through its organization, team, project or account are not
 * the key's own cap and belong to the drawer's inherited list.
 */
export async function loadDirectBudgetsForKeys(args: {
  prisma: PrismaClient;
  organizationId: string;
  virtualKeyIds: string[];
  chRepo: GatewayBudgetClickHouseRepository | undefined;
  /**
   * The instant the periods are computed from. Injectable so a test that
   * wrote a debit at a known time reads the same period back instead of
   * racing the wall clock across a midnight boundary.
   */
  now?: Date;
}): Promise<Map<string, VirtualKeyDirectBudget>> {
  const { prisma, chRepo, now = new Date() } = args;
  const out = new Map<string, VirtualKeyDirectBudget>();
  if (args.virtualKeyIds.length === 0) return out;

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
  if (chosen.size === 0) return out;

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
      periodSpentUsd: spentByBudgetId
        ? (spentByBudgetId.get(budget.id) ?? "0")
        : null,
      // Recomputed from the window rather than read off the row: the
      // stored instant is only rewritten when the window changes, so a
      // budget that has been running for days carries a reset moment
      // that has already passed.
      resetsAt: nextResetAt(budget.window, now).toISOString(),
    });
  }
  return out;
}

/**
 * One budget per key, from the rows that target them.
 *
 * A key can carry more than one cap: the one its drawer manages plus any
 * created independently on the Budgets page. The drawer's row is the one
 * the key's own field controls, so it is the one the key's row reports;
 * otherwise the oldest wins, so the choice is stable across renders.
 */
function chooseOnePerKey(
  budgets: GatewayBudget[],
  visibleKeyIds: Set<string>,
): Map<string, GatewayBudget> {
  const chosen = new Map<string, GatewayBudget>();
  for (const budget of budgets) {
    // The scope is the budget's target and wins when the caller can see
    // it. A drawer-managed row whose target is outside the visible set
    // still belongs to the key whose field manages it, so that is the
    // fallback rather than dropping the row.
    const scopedKeyId =
      budget.scopeType === "VIRTUAL_KEY" ? budget.scopeId : null;
    const keyId =
      scopedKeyId && visibleKeyIds.has(scopedKeyId)
        ? scopedKeyId
        : budget.managedByVirtualKeyId;
    if (!keyId || !visibleKeyIds.has(keyId)) continue;
    const current = chosen.get(keyId);
    if (
      !current ||
      (!current.managedByVirtualKeyId && budget.managedByVirtualKeyId)
    ) {
      chosen.set(keyId, budget);
    }
  }
  return chosen;
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
  chRepo: GatewayBudgetClickHouseRepository | undefined;
  now: Date;
}): Promise<Map<string, string> | null> {
  const { prisma, organizationId, budgets, chRepo, now } = args;
  if (!chRepo) return null;
  // ORG/TEAM/PRINCIPAL rows accrue under whichever project emitted the
  // trace, so every project in the organization is a tenant to sum over.
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  try {
    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      projects.map((p) => p.id),
      spendTargetsForBudgets(budgets),
      now,
    );
    return new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
  } catch (error) {
    // The bar degrades to "unknown" either way, but a broken rollup read
    // and an expected gap must not look the same to whoever is on call.
    captureException(toError(error), {
      extra: {
        organizationId,
        budgetIds: budgets.map((b) => b.id),
        context: "virtualKeyDirectBudget.loadPeriodSpend",
      },
    });
    return null;
  }
}
