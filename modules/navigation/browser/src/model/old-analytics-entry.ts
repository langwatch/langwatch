/** Whether an organization is old enough to have known the old Analytics pages. */

import { toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

/** An organization this many days old or older may have used the old Analytics. */
export const OLD_ANALYTICS_ORGANIZATION_MIN_AGE_DAYS = 21;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True from the moment the organization turns 21 days old (product-sidebars.feature). An
 * unknown or unreadable creation date answers true, so the entry never vanishes on a read gap.
 */
export function organizationKnewOldAnalytics({
  createdAt,
  now,
}: {
  createdAt: TimeInput | null | undefined;
  now: Instant;
}): boolean {
  if (!createdAt) return true;
  const created = toEpochMs(createdAt);
  if (Number.isNaN(created)) return true;
  return now.epochMilliseconds - created >= OLD_ANALYTICS_ORGANIZATION_MIN_AGE_DAYS * MS_PER_DAY;
}
