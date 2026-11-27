// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see modules/staff-access/specs/staff-access-functions-billing.feature */
import { describe, expect, it } from "vitest";

import {
  catalogueNameOf,
  billingOrderOf,
  factPlanOf,
  factStateOf,
  taxBehaviorOf,
} from "../billing-ops-facts.rules.ts";

describe("billing ops facts", () => {
  describe("when a stored value is one billing does not know", () => {
    /** @scenario "Unknown plan, state and tax values read as other" */
    it("reads it as other", () => {
      expect(factPlanOf("GROWTH_SEAT_EUR_MONTHLY")).toBe("GROWTH_SEAT_EUR_MONTHLY");
      expect(factPlanOf("PLATINUM")).toBe("other");
      expect(factStateOf("ACTIVE")).toBe("active");
      expect(factStateOf("PAUSED")).toBe("other");
      expect(taxBehaviorOf("exclusive")).toBe("exclusive");
      expect(taxBehaviorOf("reverse_charge")).toBe("other");
      expect(catalogueNameOf("GROWTH_SEAT_EUR_MONTHLY")).toBe("GROWTH_SEAT_EUR_MONTHLY");
      expect(catalogueNameOf("acme_custom")).toBe("other");
      expect(catalogueNameOf(null)).toBe("other");
    });
  });

  describe("when an organization holds several subscriptions", () => {
    it("bills it under the newest active, else the newest open, else the newest", () => {
      const cancelled = { id: "c", status: "CANCELLED" };
      const pending = { id: "p", status: "PENDING" };
      const active = { id: "a", status: "ACTIVE" };

      expect(billingOrderOf([pending, active, cancelled])[0]).toBe(active);
      expect(billingOrderOf([cancelled, pending])[0]).toBe(pending);
      expect(billingOrderOf([cancelled])[0]).toBe(cancelled);
      expect(billingOrderOf([])).toEqual([]);
    });
  });
});
