// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Test-only fixtures, kept out of the contract's root export. Billing's tests assert the fact it
 * records equals one of these, and nurturing's tests deliver the same one, so a change to the
 * fact breaks both. Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { Temporal } from "@langwatch/time";

import {
  type SubscriptionChangedEventData,
  subscriptionChangedEventDataSchema,
} from "./billing-lifecycle-events.ts";

const fixtureNoon = Temporal.PlainDateTime.from({ year: 2026, month: 11, day: 17, hour: 12 });

/** The instant every fixture fact is stamped with; billing's tests run their clock at it. */
export const SUBSCRIPTION_CHANGED_TEST_AT = fixtureNoon.toZonedDateTime("UTC").epochMilliseconds;

/** The organization and its two active members, as the fixture facts name them. */
export const SUBSCRIPTION_CHANGED_TEST_ORGANIZATION = {
  organizationId: "org-1",
  memberUserIds: ["user-1", "user-2"],
} as const;

/** One subscription_changed fact, parsed by billing's own schema. */
export function subscriptionChangedFactFixture(
  overrides: Partial<SubscriptionChangedEventData> = {},
): SubscriptionChangedEventData {
  const { organizationId, memberUserIds } = SUBSCRIPTION_CHANGED_TEST_ORGANIZATION;
  return subscriptionChangedEventDataSchema.parse({
    tenantId: organizationId,
    occurredAt: SUBSCRIPTION_CHANGED_TEST_AT,
    organizationId,
    memberUserIds: [...memberUserIds],
    hasSubscription: true,
    plan: "LAUNCH",
    ...overrides,
  });
}

/** The facts the linked billing and nurturing tests share, one per case. */
export const subscriptionChangedFacts = {
  /** Tiered to seat-event: the seat-event subscription activated, the tiered one retired. */
  seatEventActivated: subscriptionChangedFactFixture({ plan: "GROWTH_SEAT_EUR_MONTHLY" }),
  /** The only active subscription was cancelled. */
  lastCancelled: subscriptionChangedFactFixture({ hasSubscription: false, plan: "FREE" }),
  /** One of two active subscriptions was cancelled; the LAUNCH one remains. */
  otherRemains: subscriptionChangedFactFixture({ plan: "LAUNCH" }),
  /** The active one was cancelled and only a pending checkout remains, which is no subscription. */
  pendingOnly: subscriptionChangedFactFixture({ hasSubscription: false, plan: "FREE" }),
  /** The resync's catch-up fact for an organization on LAUNCH. */
  caughtUp: subscriptionChangedFactFixture({ plan: "LAUNCH", fromCatchUp: true }),
} as const;
