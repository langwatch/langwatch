import { describe, expect, it } from "vitest";

import {
  EUR_PER_MIB_HOUR,
  euroForMeteredMegabyteHours,
} from "../storagePricing";

describe("euroForMeteredMegabyteHours()", () => {
  describe("when an org holds a steady 8 GiB billable for a 30-day month", () => {
    /** @scenario A full month of steady storage invoices at 3 EUR per GiB */
    it("totals exactly 24 EUR (8 GiB x 3 EUR/GiB-month)", () => {
      const hourlyMegabytes = 8 * 1024; // the sampled value each hour
      const hoursInMonth = 30 * 24;
      const meterSum = hourlyMegabytes * hoursInMonth; // Stripe sum-meter total

      expect(euroForMeteredMegabyteHours(meterSum)).toBeCloseTo(24, 10);
    });
  });

  it("prices one MiB-hour at ~EUR 0.00000407", () => {
    expect(EUR_PER_MIB_HOUR).toBeCloseTo(0.00000407, 8);
  });
});
