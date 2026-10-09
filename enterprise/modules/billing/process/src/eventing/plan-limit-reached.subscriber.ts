// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PlanLimitNotifierInput } from "@langwatch/enterprise-billing-contract";
import {
  limitReachedEventDataSchema,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
} from "@langwatch/entitlement-contract";
import type { PeerSubscriberDefinition } from "@langwatch/eventing";

export const BILLING_PLAN_LIMIT_REACHED_SUBSCRIBER_NAME = "usageLimitReached";

/** Billing's ops alert for a monthly allowance usage recorded as reached (§9). */
export function planLimitReachedSubscriber({
  alerts,
}: {
  alerts: { notifyPlanLimitReached(input: PlanLimitNotifierInput): Promise<void> };
}): PeerSubscriberDefinition<typeof limitReachedEventDataSchema> {
  return {
    eventType: USAGE_LIMIT_REACHED_EVENT_TYPE,
    data: limitReachedEventDataSchema,
    handle: (data) =>
      alerts.notifyPlanLimitReached({
        organizationId: data.organizationId,
        planName: data.planName,
        usageUnit: data.unit,
        current: data.count,
        max: data.allowance,
      }),
  };
}
