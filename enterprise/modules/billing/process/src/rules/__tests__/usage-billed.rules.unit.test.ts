// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature (billing says which
 * organizations the meter bills). Each lookup is what the billing repository answers for that state.
 */
import { describe, expect, it } from "vitest";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { usageBilledOf } from "../usage-billed.rules.ts";

function billed({
  stripeCustomerId = "cus_1",
  subscriptions = [{ id: "sub_1" }],
  contract = "cloud",
}: {
  stripeCustomerId?: string | null;
  subscriptions?: { id: string }[];
  contract?: "cloud" | "connected";
} = {}): BillingReportOrganizationLookup {
  return {
    outcome: "usage_billed",
    organization: { id: "org-1", stripeCustomerId, subscriptions, contract },
  };
}

describe("usageBilledOf", () => {
  /** @scenario "The meter's own rule answers whether an organization is usage billed" */
  it.each<{ state: string; lookup: BillingReportOrganizationLookup; billed: boolean }>([
    {
      state: "on usage pricing with a Stripe customer and a subscription",
      lookup: billed(),
      billed: true,
    },
    {
      state: "on usage pricing with no subscription",
      lookup: billed({ subscriptions: [] }),
      billed: false,
    },
    {
      state: "on usage pricing with no Stripe customer",
      lookup: billed({ stripeCustomerId: null }),
      billed: false,
    },
    { state: "on tiered pricing", lookup: { outcome: "not_usage_billed" }, billed: false },
    {
      state: "marked self-hosted with a connected billing account",
      lookup: billed({ stripeCustomerId: "cus_connected", contract: "connected" }),
      billed: true,
    },
    { state: "that does not exist", lookup: { outcome: "not_found" }, billed: false },
  ])("answers $billed for an organization $state", ({ lookup, billed: expected }) => {
    expect(usageBilledOf({ lookup }).usageBilled).toBe(expected);
  });

  it("names why an organization is not billed, so the monthly report logs it", () => {
    expect(usageBilledOf({ lookup: { outcome: "not_found" } })).toEqual({
      usageBilled: false,
      reason: "not_found",
    });
    expect(usageBilledOf({ lookup: billed({ subscriptions: [] }) })).toEqual({
      usageBilled: false,
      reason: "no_active_subscription",
    });
  });
});
