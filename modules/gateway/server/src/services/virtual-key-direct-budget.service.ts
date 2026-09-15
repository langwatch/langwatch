/**
 * The budget a key carries on itself, with spend in its own current period. That is distinct from
 * calendar-month spend: a daily cap measures against today, so a monthly figure and a daily one
 * are both true and neither substitutes. Spend comes from the rollup every other surface reads.
 */
import { type Instant, nowInstant } from "@langwatch/time";
import type { GatewayBudget } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { budgetSpendTargetsFor } from "../app/gateway.members.ts";
import type { VirtualKeyDirectBudgetRepository } from "../repositories/gateway-virtual-key-direct-budget.repository.ts";
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
 * One budget per key, from the rows that target them. A key can carry more than one cap, drawer
 * managed plus independently created; the drawer's row is what the key's own field controls and
 * reports, and otherwise the oldest wins for stable rendering.
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
 * Visible key a budget row reports against, or null if none. The budget's scope target wins when
 * the caller can see it; a drawer-managed row whose target is outside the visible set still
 * belongs to the key managing it, so that key is the fallback rather than dropping the row.
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
  repository: VirtualKeyDirectBudgetRepository;
  organizationId: string;
  budgets: GatewayBudget[];
  chRepo: GatewayBudgetSpend | undefined;
  now: Instant;
}): Promise<Map<string, string> | null> {
  const { repository, organizationId, budgets, chRepo, now } = args;
  if (!chRepo) {
    return null;
  }

  const projectIds = await repository.findProjectIdsInOrganization({ organizationId });
  try {
    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      projectIds,
      budgetSpendTargetsFor({ budgets, now }),
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
  private constructor(private readonly repository: VirtualKeyDirectBudgetRepository) {}

  static create(input: {
    repository: VirtualKeyDirectBudgetRepository;
  }): VirtualKeyDirectBudgetService {
    return new VirtualKeyDirectBudgetService(input.repository);
  }

  /**
   * Resolves one direct budget per key, keyed by key id, with keys carrying none absent. Direct
   * means the key's own row: a key-scoped budget targeting it, or the row its drawer field
   * manages. Budgets reached via org, team, project or account belong to the inherited list.
   */
  async loadDirectBudgetsForKeys(args: {
    organizationId: string;
    virtualKeyIds: string[];
    chRepo: GatewayBudgetSpend | undefined;
    /**
     * The instant the periods are computed from. Injectable so a test that
     * wrote a debit at a known time reads the same period back instead of
     * racing the wall clock across a midnight boundary.
     */
    now?: Instant;
  }): Promise<Map<string, VirtualKeyDirectBudget>> {
    const { chRepo, now = nowInstant() } = args;
    const out = new Map<string, VirtualKeyDirectBudget>();
    if (args.virtualKeyIds.length === 0) {
      return out;
    }

    const budgets = await this.repository.findBudgetsTargetingKeys({
      organizationId: args.organizationId,
      virtualKeyIds: args.virtualKeyIds,
    });

    const chosen = chooseOnePerKey(budgets, new Set(args.virtualKeyIds));
    if (chosen.size === 0) {
      return out;
    }

    const spentByBudgetId = await loadPeriodSpend({
      repository: this.repository,
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
        resetsAt: GatewayWindow.nextResetAt(budget.window, now).toString({
          fractionalSecondDigits: 3,
        }),
      });
    }

    return out;
  }
}
