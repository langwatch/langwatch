import {
  bucketScopeIdFor,
  computeBudgetPeriodFloorMs,
  type GatewayBudgetResource,
  PROVIDER_BUCKET_SEPARATOR,
} from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { BudgetSpendTarget } from "../app/gateway.members.ts";

/**
 * Read targets for a plain list of budgets, no request context (a GROUP
 * budget sums every member bucket). `now` is shared with the rollup read so
 * an anchored budget's moving floor agrees across both halves of the read.
 */
export function budgetSpendTargetsFor({
  budgets,
  now = nowInstant(),
}: {
  budgets: GatewayBudgetResource[];
  now?: Instant;
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
          bucketSuffix: b.providerKey ? `${PROVIDER_BUCKET_SEPARATOR}${b.providerKey}` : null,
          // MANUAL windows, anchored cycles and mid-period resets all move
          // the boundary; the list must total the CURRENT period, same as
          // enforcement does.
          periodFloorMs: computeBudgetPeriodFloorMs(b, now),
        }
      : {
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: bucketScopeIdFor(b, b.scopeId),
          window: b.window,
          match: "exact" as const,
          periodFloorMs: computeBudgetPeriodFloorMs(b, now),
        },
  );
}
