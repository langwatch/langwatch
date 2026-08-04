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
import { decimalUsdToNanoUsd, usdDisplayString } from "./wireMoney";

export /**
 * The budget row on the wire.
 *
 * `spendAvailable` is false when spend could not be totalled. The stored
 * `spentUsd` is then a stale column, not spend, so both spend fields answer
 * null: a caller that ignored the flag used to read the stale figure as real
 * money, and null is the only value that cannot be misread that way.
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
    spent_usd: spendAvailable ? usdDisplayString(b.spentUsd) : null,
    spent_nano_usd: spendAvailable ? decimalUsdToNanoUsd(b.spentUsd) : null,
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
