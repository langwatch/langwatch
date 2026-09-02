/**
 * How many billable units an organization has used this period, and which unit
 * it is measured in.
 *
 * Both answers come from outside this feature — the count is a ClickHouse
 * rollup and the unit falls out of the deployment's pricing model — so the
 * reading takes them as a port rather than reaching for either.
 */
import type { UsageUnit } from "@langwatch/entitlement-contract";

/**
 * What a counter answers when it could not count.
 *
 * A sentinel rather than `0`, because the two are different facts: an
 * organization that genuinely sent nothing this month, and a counting store
 * that could not be reached. Every consumer used to read the second as the
 * first — enforcement saw an organization comfortably inside its cap, the
 * approaching-limit notifier saw nobody worth warning, and the usage page
 * rendered a confident zero. An outage in the counting store silently switched
 * off metering and told customers their usage had vanished.
 */
export const USAGE_UNKNOWN = "unknown" as const;

/** A usage count, or {@link USAGE_UNKNOWN} when it could not be determined. */
export type UsageCount = number | typeof USAGE_UNKNOWN;

export abstract class UsageCounterPort {
  /**
   * The real current-period volume, computed even for unlimited (seat-based)
   * plans where enforcement would not bother counting: the usage page shows
   * actual billable volume whatever the cap is.
   */
  abstract getCurrentMonthCountForDisplay(
    input: Readonly<{ organizationId: string }>,
  ): Promise<UsageCount>;

  /** Whether this organization is metered in traces or in events. */
  abstract getResolvedUsageUnit(
    input: Readonly<{ organizationId: string }>,
  ): Promise<UsageUnit>;
}
