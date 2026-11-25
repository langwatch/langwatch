// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import { activePlanOf } from "../active-plan.rules.ts";

describe("activePlanOf", () => {
  it("answers the active subscription's plan type", () => {
    const plan = "GROWTH_SEAT_EUR_MONTHLY";

    expect(activePlanOf({ active: { plan } })).toBe(plan);
  });

  it("answers FREE when no subscription is active", () => {
    expect(activePlanOf({ active: null })).toBe("FREE");
  });

  it("answers FREE for a plan billing does not know, as the plan provider falls back", () => {
    expect(activePlanOf({ active: { plan: "RETIRED_PLAN" } })).toBe("FREE");
  });
});
