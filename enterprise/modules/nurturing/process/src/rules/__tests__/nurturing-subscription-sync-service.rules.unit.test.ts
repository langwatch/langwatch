// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a subscription change tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import { fireSubscriptionSync } from "../nurturing-subscription-sync-service.rules.ts";

describe("fireSubscriptionSync", () => {
  it("decides one has_subscription identify per member", () => {
    expect(
      fireSubscriptionSync({ memberUserIds: ["user-1", "user-2"], hasSubscription: true }),
    ).toEqual([
      { type: "identify", userId: "user-1", traits: { has_subscription: true } },
      { type: "identify", userId: "user-2", traits: { has_subscription: true } },
    ]);
  });
});
