// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see enterprise/modules/billing/specs/checkout-volume.feature */
import { SubscriptionAlreadyActiveError } from "@langwatch/enterprise-billing-contract";
import type { CounterHandle } from "@langwatch/observability/metrics";
import { describe, expect, it } from "vitest";

import { BillingCheckoutMeterService } from "../billing-checkout-meter.service.ts";

const recordingCounter = () => {
  const increments: Record<string, unknown>[] = [];
  const handle: CounterHandle = {
    inc(attributes = {}, value = 1) {
      for (let i = 0; i < value; i++) increments.push({ ...attributes });
    },
  };
  return { handle, increments };
};

describe("BillingCheckoutMeterService", () => {
  describe("when the checkout answers a payment page", () => {
    /** @scenario "A checkout that answers a payment page is counted as started" */
    it("counts one started checkout for the flow", async () => {
      const { handle, increments } = recordingCounter();
      const meter = BillingCheckoutMeterService.create(handle);

      const result = await meter.track("subscription", async () => ({
        url: "https://checkout.stripe.com/c/pay/test",
      }));

      expect(result.url).toBe("https://checkout.stripe.com/c/pay/test");
      expect(increments).toEqual([{ stage: "started", flow: "subscription" }]);
    });
  });

  describe("when the checkout is refused with a handled error", () => {
    /** @scenario "A refused checkout is counted with its error code" */
    it("counts the failure by code and rethrows it", async () => {
      const { handle, increments } = recordingCounter();
      const meter = BillingCheckoutMeterService.create(handle);

      await expect(
        meter.track("subscription", async () => {
          throw new SubscriptionAlreadyActiveError();
        }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });

      expect(increments).toEqual([
        { stage: "failed", flow: "subscription", code: "subscription_already_active" },
      ]);
    });
  });

  describe("when the checkout fails unexpectedly", () => {
    /** @scenario "An unexpected checkout failure is counted without its internals" */
    it("counts the failure as unhandled", async () => {
      const { handle, increments } = recordingCounter();
      const meter = BillingCheckoutMeterService.create(handle);

      await expect(
        meter.track("seat_checkout", async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:443");
        }),
      ).rejects.toThrow("ECONNREFUSED");

      expect(increments).toEqual([{ stage: "failed", flow: "seat_checkout", code: "unhandled" }]);
    });
  });

  describe("when the checkout answers no payment page", () => {
    /** @scenario "A checkout that answers no payment page is counted as failed" */
    it("counts a failure, not a start", async () => {
      const { handle, increments } = recordingCounter();
      const meter = BillingCheckoutMeterService.create(handle);

      await meter.track("seat_checkout", async () => ({ url: null }));

      expect(increments).toEqual([
        { stage: "failed", flow: "seat_checkout", code: "no_checkout_url" },
      ]);
    });
  });

  describe("when the payment provider reports a completed checkout", () => {
    /** @scenario "A completed checkout is counted" */
    it("counts one completed checkout", () => {
      const { handle, increments } = recordingCounter();
      const meter = BillingCheckoutMeterService.create(handle);

      meter.completed();

      expect(increments).toEqual([{ stage: "completed" }]);
    });
  });
});
