/**
 * The fixed quantities a usage warning is decided by: the thresholds it fires at, the month it
 * counts within, and what the warning is composed over.
 */
import type {
  BillingUsageCounter,
  BillingUsageLimitOrganization,
} from "@langwatch/enterprise-billing-contract";
import type { NotificationService as NotificationRecordService } from "@langwatch/notification-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { NotificationService } from "../services/billing-usage-notice.service.ts";

/** Ascending, so the last one passed is the highest one crossed. */
export const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

export const getCurrentMonthStart = (): Instant => {
  const now = nowInstant().toZonedDateTimeISO("UTC");

  return Temporal.PlainDateTime.from({ year: now.year, month: now.month, day: 1 })
    .toZonedDateTime("UTC")
    .toInstant();
};

/** The highest warning threshold this usage percentage has crossed, or nothing below them all. */
export function findCrossedUsageThreshold(
  usagePercentage: number,
): (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined {
  let crossed: (typeof USAGE_WARNING_THRESHOLDS)[number] | undefined;
  for (const threshold of USAGE_WARNING_THRESHOLDS) {
    if (usagePercentage >= threshold) {
      crossed = threshold;
    }
  }

  return crossed;
}

export type UsageWarningServiceOptions = {
  records: Pick<NotificationRecordService, "listRecentByOrganization" | "create">;
  organizations: BillingUsageLimitOrganization;
  usageCounts: BillingUsageCounter;
  emails: Pick<NotificationService, "sendUsageLimitEmail">;
  baseHost: string;
};
