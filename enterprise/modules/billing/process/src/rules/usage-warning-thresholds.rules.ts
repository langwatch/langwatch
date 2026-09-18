/**
 * The fixed quantities a usage warning is decided by: the thresholds it fires at, the month it
 * counts within, and the two deployment hooks that colour the mail.
 */
import type {
  BillingPricingModel,
  BillingUsageCounter,
  BillingUsageLimitOrganization,
} from "@langwatch/enterprise-billing-contract";
import type { NotificationService as NotificationRecordService } from "@langwatch/notification-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type {
  NotificationService,
  UsageLimitEmailData,
} from "../services/billing-usage-notice.service.ts";

/** What an organization's usage is metered in, resolved by the deployment's own meter policy. */
export type BillingUsageUnit = "traces" | "events";

/**
 * Where organization can go next; structural type avoids cross-package
 * entitlement-server dependency.
 */
export type BillingNextStepResolver = {
  find(input: {
    organizationId: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
  }): Promise<NonNullable<UsageLimitEmailData["nextStep"]> | undefined>;
};

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
  records: NotificationRecordService;
  organizations: BillingUsageLimitOrganization;
  usageCounts: BillingUsageCounter;
  emails: NotificationService;
  baseHost: string;
  /** Resolves where the organization can go next. Absent skips the hook. */
  nextStep?: BillingNextStepResolver;
  /** What the organization is metered in, from the deployment's own meter policy. */
  usageUnit?: (input: { organizationId: string }) => Promise<BillingUsageUnit | undefined>;
};
