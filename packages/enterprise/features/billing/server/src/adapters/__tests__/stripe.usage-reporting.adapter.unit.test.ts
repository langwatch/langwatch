// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import {
  StripeUsageReportingAdapter,
  StripeUsageReportingUnavailable,
} from "../stripe.usage-reporting.adapter";
import { StripeUsageReportingService } from "../../services/usage-reporting.service";

function meterIdFor(nodeEnvironment: string | undefined): string {
  const create = vi.spyOn(StripeUsageReportingService, "create");
  try {
    StripeUsageReportingAdapter.create({
      secretKey: "sk_test_composition",
      nodeEnvironment,
    }).build();
    const [deps] = create.mock.calls[0] as unknown as [{ meterId: string }];
    return deps.meterId;
  } finally {
    create.mockRestore();
  }
}

describe("StripeUsageReportingAdapter", () => {
  describe("given a process composing its own usage reporter", () => {
    /**
     * Frozen twin: the App resolves the same meter through
     * `BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(process.env.NODE_ENV))`
     * and reports into it from the same monthly command. The ids are LITERAL
     * here because a graph pointed at the other mode's meter still composes,
     * still sends, and is wrong in a way only a Stripe invoice shows.
     */
    /** @scenario "The worker reports into the meter the App reports into" */
    it("selects the live meter in production and the test meter everywhere else", () => {
      expect(meterIdFor("production")).toBe("mtr_61UBLon1Ka5iWAcoH41IMsTw08cudD7o");
      expect(meterIdFor("development")).toBe("mtr_test_61UBL0fe0hM4Csg7x41IMsTw08cudQaG");
      expect(meterIdFor(undefined)).toBe("mtr_test_61UBL0fe0hM4Csg7x41IMsTw08cudQaG");
    });

    /**
     * The App refuses the same way, at `AppStripeRuntime.create`. A SaaS
     * process that composed a reporter it could not send through would count
     * every billable event correctly and report none of them, and the handler's
     * own skip path logs that once a month rather than raising it at boot.
     */
    /** @scenario "A SaaS worker refuses to compose without the credential its reports are sent with" */
    it("refuses to build without a secret key", () => {
      expect(() =>
        StripeUsageReportingAdapter.create({
          secretKey: undefined,
          nodeEnvironment: "production",
        }).build(),
      ).toThrow(StripeUsageReportingUnavailable);
    });
  });
});
