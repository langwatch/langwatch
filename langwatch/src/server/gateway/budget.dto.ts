/**
 * Shared DTO shape for GatewayBudget on the public REST wire, the budget
 * counterpart to `virtualKey.dto.ts`.
 *
 * Lives outside the route file so the money and availability rules it encodes
 * can be asserted directly, without standing up a request to find out what a
 * budget with no spend source renders as.
 */
import type { GatewayBudgetWithSeats } from "./budget.service";
import { toWireEnum } from "./wireEnums";
import { decimalUsdToNanoUsd } from "./wireMoney";

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
    limit_usd: b.limitUsd.toString(),
    limit_nano_usd: decimalUsdToNanoUsd(b.limitUsd),
    spent_usd: spendAvailable ? b.spentUsd.toString() : null,
    spent_nano_usd: spendAvailable ? decimalUsdToNanoUsd(b.spentUsd) : null,
    timezone: b.timezone,
    provider_key: b.providerKey,
    current_period_started_at: b.currentPeriodStartedAt.toISOString(),
    resets_at: b.resetsAt.toISOString(),
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
