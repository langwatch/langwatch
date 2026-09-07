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
import type { NotificationService } from "../services/billing-usage-notice.service.ts";
import type { UsageLimitEmailData } from "../services/billing-usage-notice.service.ts";

/** What an organization's usage is metered in, resolved by the deployment's own meter policy. */
export type BillingUsageUnit = "traces" | "events";

/**
 * Where this organization can go next, as `UsageLimitEmailData["nextStep"]` shapes it.
 *
 * A plain structural type rather than an import of `PlanNextStepService`: this package
 * does not depend on `@langwatch/entitlement-server`. Reading the organization's own
 * plan is this collaborator's job too — folding it in here, rather than taking a
 * separate `plans` port, keeps the FULL `Plan` shape `PlanNextStepService.resolve`
 * needs out of this package, which only ever sees the result.
 */
export type BillingNextStepResolver = {
  resolve(input: {
    organizationId: string;
    pricingModel: BillingPricingModel | null;
    currency: "USD" | "EUR";
  }): Promise<NonNullable<UsageLimitEmailData["nextStep"]> | undefined>;
};

/** Ascending, so the last one passed is the highest one crossed. */
export const USAGE_WARNING_THRESHOLDS = [50, 70, 90, 95, 100] as const;

export const getCurrentMonthStart = (): Date => {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/** The highest warning threshold this usage percentage has crossed, or nothing below them all. */
export function crossedUsageThreshold(
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
