/**
 * The month a usage warning is sent once within, and what the send is composed over. The
 * thresholds it fires at are entitlement's decision, not billing's.
 */
import type { BillingUsageLimitOrganization } from "@langwatch/enterprise-billing-contract";
import type { NotificationService as NotificationRecordService } from "@langwatch/notification-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { NotificationService } from "../services/billing-usage-notice.service.ts";

export const getCurrentMonthStart = (): Instant => {
  const now = nowInstant().toZonedDateTimeISO("UTC");

  return Temporal.PlainDateTime.from({ year: now.year, month: now.month, day: 1 })
    .toZonedDateTime("UTC")
    .toInstant();
};

export type UsageWarningServiceOptions = {
  records: Pick<NotificationRecordService, "listRecentByOrganization" | "create">;
  organizations: BillingUsageLimitOrganization;
  emails: Pick<NotificationService, "sendUsageLimitEmail">;
  baseHost: string;
};
