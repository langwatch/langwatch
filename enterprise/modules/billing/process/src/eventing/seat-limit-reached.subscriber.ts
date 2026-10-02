// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ResourceLimitNotifierInput } from "@langwatch/enterprise-billing-contract";
import type { PeerSubscriberDefinition } from "@langwatch/eventing";
import {
  SEAT_LIMIT_REACHED_EVENT_TYPE,
  seatLimitReachedEventDataSchema,
} from "@langwatch/organization-contract";

export const BILLING_SEAT_LIMIT_REACHED_SUBSCRIBER_NAME = "organizationSeatLimitReached";

/** Billing's ops alert for a seat limit organization recorded as reached (§9). */
export function seatLimitReachedSubscriber({
  alerts,
}: {
  alerts: { notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void> };
}): PeerSubscriberDefinition<typeof seatLimitReachedEventDataSchema> {
  return {
    eventType: SEAT_LIMIT_REACHED_EVENT_TYPE,
    data: seatLimitReachedEventDataSchema,
    handle: (data) =>
      alerts.notifyResourceLimitReached({
        organizationId: data.organizationId,
        limitType: data.limitType,
        current: data.current,
        max: data.max,
      }),
  };
}
