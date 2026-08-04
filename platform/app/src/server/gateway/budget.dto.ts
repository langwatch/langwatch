/**
 * Shared DTO shape for GatewayBudget on the public REST wire, the budget
 * counterpart to `virtualKey.dto.ts`.
 *
 * Lives outside the route file so the money and availability rules it encodes
 * can be asserted directly, without standing up a request to find out what a
 * budget with no spend source renders as.
 */
import { effectiveBudgetPeriod } from "./budget.clickhouse.repository";
import type { GatewayBudgetWithSeats } from "./budget.service";
import { metadataFromRow } from "./resourceMetadata";
import { toWireEnum } from "./wireEnums";
import {
  decimalUsdToNanoUsd,
  nanoUsdToDecimalString,
  usdDisplayString,
} from "./wireMoney";

/**
 * What this row reports as spend, in both units, or null when there is no
 * total this row can honestly carry.
 *
 * Two rows have no total. `spendAvailable` false means spend could not be
 * read at all, and the stored `spentUsd` is then a stale column rather than
 * spend. A per-person template has no single total by construction: it is one
 * allowance per end user, so its spend is a distribution, and the seats it is
 * watching are reported as `end_users_seen` / `end_users_over` instead. Both
 * answer null, because a caller that ignored the distinction used to read a
 * confident figure as real money, and null is the only value that cannot be
 * misread that way.
 *
 * When there is a total, the integer is the ledger's own and the string is
 * that integer rendered. Deriving the pair the other way round, from the
 * decimal, cannot recover digits the decimal never carried.
 */
function spendFields(b: GatewayBudgetWithSeats, spendAvailable: boolean) {
  if (!spendAvailable || b.scopeType === "ATTRIBUTED_USER") {
    return { spent_usd: null, spent_nano_usd: null };
  }
  const nano = b.spentNanoUsd ?? decimalUsdToNanoUsd(b.spentUsd);
  return {
    spent_usd:
      nano === null
        ? usdDisplayString(b.spentUsd)
        : nanoUsdToDecimalString(nano),
    spent_nano_usd: nano,
  };
}

export /**
 * The budget row on the wire.
 */
function toBudgetDto(
  b: GatewayBudgetWithSeats,
  memberCount?: number,
  spendAvailable = true,
) {
  // The period is computed here rather than read off the row. The stored
  // columns move only at create and at an explicit reset, so a budget past
  // its first boundary carries a start from months ago and a reset instant
  // in the past, while the spend beside them is the current period's. The
  // pair has to bracket the figure it is printed next to.
  const period = effectiveBudgetPeriod(b);
  return {
    id: b.id,
    organization_id: b.organizationId,
    scope_type: toWireEnum(b.scopeType),
    scope_id: b.scopeId,
    name: b.name,
    description: b.description,
    window: toWireEnum(b.window),
    on_breach: toWireEnum(b.onBreach),
    // `_usd` is the display value; `_nano_usd` is the canonical integer, the
    // same unit the spend events carry, so the two reconcile without parsing
    // decimals. Null nano means the amount is past the safe integer range.
    limit_usd: usdDisplayString(b.limitUsd),
    limit_nano_usd: decimalUsdToNanoUsd(b.limitUsd),
    ...spendFields(b, spendAvailable),
    timezone: b.timezone,
    provider_key: b.providerKey,
    external_id: b.externalId ?? null,
    metadata: metadataFromRow(b.metadata),
    current_period_started_at: period.currentPeriodStartedAt.toISOString(),
    resets_at: period.resetsAt.toISOString(),
    // Null is calendar alignment. Set, it is the phase the window cycles
    // on, and the period fields above describe that cycle rather than the
    // calendar one.
    cycle_anchor_at: b.cycleAnchorAt?.toISOString() ?? null,
    last_reset_at: b.lastResetAt?.toISOString() ?? null,
    archived_at: b.archivedAt?.toISOString() ?? null,
    created_at: b.createdAt.toISOString(),
    ...(memberCount !== undefined ? { member_count: memberCount } : {}),
    // Per-person templates only: one allowance per end user, so the wire
    // reports the distribution instead of pretending there is one total.
    ...(b.endUsersSeen !== undefined ? { end_users_seen: b.endUsersSeen } : {}),
    ...(b.endUsersOver !== undefined ? { end_users_over: b.endUsersOver } : {}),
  };
}
