/**
 * Budgets to spend-read targets, with no request context.
 *
 * Pure translation: it decides which ledger buckets a budget's "spent so
 * far" has to sum, and from which instant. It lives beside the bucket-key
 * and period adapters it composes rather than inside the ClickHouse
 * repository, because every surface that renders a budget next to its
 * spend — the budgets page, the key drawer, the overview — has to ask for
 * the same targets, and a second spelling of this mapping would let a cap
 * and its usage disagree about which period they describe.
 */
import type { GatewayBudgetResource } from "@langwatch/gateway-contract";
import type { BudgetSpendTarget } from "../ports/gateway-budget-spend.port";
import { bucketScopeIdFor, PROVIDER_BUCKET_SEPARATOR } from "./gateway-bucket-scope.adapter";
import { budgetPeriodFloorMs } from "./gateway-period.adapter";

/**
 * Read targets for a plain list of budgets, with no request context. A
 * GROUP budget has no single member here, so it sums every member bucket.
 *
 * `now` is the instant the periods are resolved at, and it is the same one
 * the rollup read uses. Passing it here rather than letting each floor read
 * the wall clock is what makes an injected clock mean one thing across both
 * halves of the read; an anchored budget in particular has a floor that
 * moves with the clock, so the two halves would otherwise disagree about
 * which period they are totalling.
 */
export function spendTargetsForBudgets({
  budgets,
  now = new Date(),
}: {
  budgets: GatewayBudgetResource[];
  now?: Date;
}): BudgetSpendTarget[] {
  return budgets.map((b) =>
    b.scopeType === "GROUP"
      ? {
          budgetId: b.id,
          scope: b.scopeType,
          // The member id sits between the group prefix and the provider
          // suffix, so a provider-filtered group budget cannot be a plain
          // prefix target: the prefix is the bare group, and the provider
          // filter anchors the suffix instead.
          scopeId: `${b.scopeId}:`,
          window: b.window,
          match: "prefix" as const,
          bucketSuffix: b.providerKey
            ? `${PROVIDER_BUCKET_SEPARATOR}${b.providerKey}`
            : null,
          // MANUAL windows, anchored cycles and mid-period resets all move
          // the boundary; the list must total the CURRENT period, same as
          // enforcement does.
          periodFloorMs: budgetPeriodFloorMs(b, now),
        }
      : {
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: bucketScopeIdFor(b, b.scopeId),
          window: b.window,
          match: "exact" as const,
          periodFloorMs: budgetPeriodFloorMs(b, now),
        },
  );
}
