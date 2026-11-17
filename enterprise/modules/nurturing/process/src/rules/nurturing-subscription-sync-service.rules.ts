// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  CioPersonTraits,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

import type { PostHogEventInput } from "../channels/posthog.channel.ts";

/** Members per Customer.io request, so a large organization never sends one huge batch. */
export const SUBSCRIPTION_MEMBERS_PER_REQUEST = 100;

/** Billing's plan type as Customer.io's `plan`: lower case, as sign-up's "free" already is. */
export function customerIoPlanOf(plan: string): string {
  return plan.toLowerCase();
}

type SubscriptionSyncInput = Pick<
  NurturingSignalOf<"subscription_changed">,
  "organizationId" | "memberUserIds" | "hasSubscription" | "plan" | "organizationName"
> & {
  /** The admin nurturing's copy names; without one, the first member carries the company call. */
  adminUserId: string | null;
};

/**
 * Decides a subscription change's requests, in order: one group call carrying the plan (and a
 * catch-up's name) to the admin, then the members' identifies, at most 100 a request. A fact with
 * no plan sends has_subscription only and no group call; no member, nothing.
 */
export function fireSubscriptionSync({
  organizationId,
  memberUserIds,
  hasSubscription,
  plan,
  organizationName,
  adminUserId,
}: SubscriptionSyncInput): CioBatchCall[][] {
  const groupUserId = adminUserId ?? memberUserIds[0];
  if (groupUserId === undefined || memberUserIds.length === 0) return [];

  const planTrait = plan === undefined ? {} : { plan: customerIoPlanOf(plan) };
  const traits: Partial<CioPersonTraits> = { has_subscription: hasSubscription, ...planTrait };
  const requests: CioBatchCall[][] = [];
  if (plan !== undefined) {
    const name = organizationName === undefined ? {} : { name: organizationName };
    const group: CioBatchCall = {
      type: "group",
      userId: groupUserId,
      groupId: organizationId,
      traits: { ...planTrait, ...name },
    };
    requests.push([group]);
  }

  const size = SUBSCRIPTION_MEMBERS_PER_REQUEST;
  for (let start = 0; start < memberUserIds.length; start += size) {
    const batch = memberUserIds.slice(start, start + size);
    requests.push(batch.map((userId) => ({ type: "identify" as const, userId, traits })));
  }
  return requests;
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
