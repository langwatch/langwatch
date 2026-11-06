// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see enterprise/modules/billing/specs/checkout-volume.feature */
import { SubscriptionAlreadyActiveError } from "@langwatch/enterprise-billing-contract";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BILLING_CHECKOUT_TOTAL_METRIC_NAME,
  BillingCheckoutMeterService,
} from "../billing-checkout-meter.service.ts";

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/test";
const LICENSE_LINK = "plink_license";

describe("BillingCheckoutMeterService", () => {
  let metrics = createRecordingMeterProvider();
  const written = () =>
    metrics.recorded
      .filter((write) => write.instrument === BILLING_CHECKOUT_TOTAL_METRIC_NAME)
      .map(({ value, attributes }) => ({ value, attributes }));

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    metrics.install();
  });
  afterEach(() => metrics.uninstall());

  it("writes the series the checkout-volume alert reads", async () => {
    await BillingCheckoutMeterService.create().track("subscription", async () => ({
      url: CHECKOUT_URL,
    }));

    expect(BILLING_CHECKOUT_TOTAL_METRIC_NAME).toBe("billing_checkout_total");
    expect(metrics.descriptionOf("billing_checkout_total")).toBe(
      "Billing checkouts by stage (started, failed, completed), flow and failure reason",
    );
  });

  describe("when the checkout answers a payment page", () => {
    /** @scenario "A checkout that answers a payment page is counted as started" */
    it("counts one started checkout for the flow", async () => {
      const result = await BillingCheckoutMeterService.create().track("subscription", async () => ({
        url: CHECKOUT_URL,
      }));

      expect(result.url).toBe(CHECKOUT_URL);
      expect(written()).toEqual([
        { value: 1, attributes: { stage: "started", flow: "subscription" } },
      ]);
    });
  });

  describe("when the checkout is refused with a handled error", () => {
    /** @scenario "A refused checkout is counted with its error code" */
    it("counts the failure by its error code and rethrows it", async () => {
      await expect(
        BillingCheckoutMeterService.create().track("subscription", async () => {
          throw new SubscriptionAlreadyActiveError();
        }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });

      expect(written()).toEqual([
        {
          value: 1,
          attributes: {
            stage: "failed",
            flow: "subscription",
            reason: "subscription_already_active",
          },
        },
      ]);
    });
  });

  describe("when the checkout fails unexpectedly", () => {
    /** @scenario "An unexpected checkout failure is counted without its internals" */
    it("counts the failure as unhandled", async () => {
      await expect(
        BillingCheckoutMeterService.create().track("seat_checkout", async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.1:443");
        }),
      ).rejects.toThrow("ECONNREFUSED");

      expect(written()).toEqual([
        { value: 1, attributes: { stage: "failed", flow: "seat_checkout", reason: "unhandled" } },
      ]);
    });
  });

  describe("when the checkout answers no payment page", () => {
    /** @scenario "A checkout that answers no payment page is counted as failed" */
    it("counts a failure, not a start", async () => {
      await BillingCheckoutMeterService.create().track("seat_checkout", async () => ({
        url: null,
      }));

      expect(written()).toEqual([
        {
          value: 1,
          attributes: { stage: "failed", flow: "seat_checkout", reason: "no_checkout_url" },
        },
      ]);
    });
  });

  describe("when the payment provider reports a completed checkout", () => {
    /** @scenario "A completed checkout is counted" */
    it("counts one completed checkout", () => {
      BillingCheckoutMeterService.create().completed({
        session: { subscription: "sub_1", payment_link: null },
        licensePaymentLinkId: LICENSE_LINK,
      });

      expect(written()).toEqual([{ value: 1, attributes: { stage: "completed" } }]);
    });
  });

  describe("when the completed checkout is not a subscription checkout", () => {
    /** @scenario "A license purchase or a session without a subscription is not counted as completed" */
    it("counts nothing for a license purchase or a session without a subscription", () => {
      const meter = BillingCheckoutMeterService.create();

      meter.completed({
        session: { subscription: "sub_license", payment_link: LICENSE_LINK },
        licensePaymentLinkId: LICENSE_LINK,
      });
      meter.completed({
        session: { subscription: null, payment_link: null },
        licensePaymentLinkId: LICENSE_LINK,
      });

      expect(written()).toEqual([]);
    });
  });

  describe("when billing starts", () => {
    it("writes zero starts for each door", () => {
      BillingCheckoutMeterService.create().seedStarts();

      expect(written()).toEqual([
        { value: 0, attributes: { stage: "started", flow: "subscription" } },
        { value: 0, attributes: { stage: "started", flow: "seat_checkout" } },
      ]);
    });
  });
});
