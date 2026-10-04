// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

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
