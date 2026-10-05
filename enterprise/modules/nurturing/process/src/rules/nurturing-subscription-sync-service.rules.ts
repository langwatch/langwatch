// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";

import type { PostHogEventInput } from "../channels/posthog.channel.ts";

/**
 * Decides the has_subscription identify call for every member of an organization; the
 * owner names the members when it records the change.
 */
export function fireSubscriptionSync({
  memberUserIds,
  hasSubscription,
}: {
  memberUserIds: readonly string[];
  hasSubscription: boolean;
}): CioBatchCall[] {
  return memberUserIds.map((userId) => ({
    type: "identify",
    userId,
    traits: { has_subscription: hasSubscription },
  }));
}

/**
 * Decides the PostHog subscription_started event for every member of an organization whose
 * subscription became active. Each member gets it because a funnel follows a person, and the
 * one who arrived from a campaign is rarely the one who paid. Count distinct organization_id
 * for the number of subscriptions started.
 */
export function fireSubscriptionStarted({
  organizationId,
  memberUserIds,
  plan,
}: Pick<
  NurturingSignalOf<"subscription_started">,
  "organizationId" | "memberUserIds" | "plan"
>): PostHogEventInput[] {
  return memberUserIds.map((userId) => ({
    userId,
    event: "subscription_started",
    properties: {
      plan,
      organization_id: organizationId,
      $groups: { organization: organizationId },
    },
  }));
}
