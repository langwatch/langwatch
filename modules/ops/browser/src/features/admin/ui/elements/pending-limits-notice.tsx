import { Banner } from "@langwatch/design-system/banner";

import type { SubscriptionStatus } from "../../model/admin-enums.ts";

/** The plan reads ACTIVE rows only, so limits typed on a PENDING row change nothing yet. */
export function PendingLimitsNotice({
  status,
  hasLimits,
}: {
  status: SubscriptionStatus;
  /** At least one limit field holds a value. */
  hasLimits: boolean;
}) {
  if (status !== "PENDING" || !hasLimits) return null;
  return (
    <Banner
      status="warning"
      title="These limits do nothing yet"
      data-testid="pending-limits-notice"
    >
      This subscription is PENDING. Its limits apply only once its status is ACTIVE; until then the
      organization keeps the limits of its active plan.
    </Banner>
  );
}
