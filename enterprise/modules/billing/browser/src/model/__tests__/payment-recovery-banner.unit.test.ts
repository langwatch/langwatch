/**
 * What the payment banner says per recovery state and reader.
 * @see enterprise/modules/billing/specs/payment-recovery.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { paymentRecoveryBanner } from "../payment-recovery-banner.ts";

const ACCESS_STOPS_AT = "2026-11-30T20:00:00Z";
const daysBeforeStop = (days: number) =>
  Temporal.Instant.from(ACCESS_STOPS_AT).subtract({ hours: days * 24 }).epochMilliseconds;

const read = ({
  state,
  canPay,
  now = daysBeforeStop(17),
}: {
  state: "none" | "failing" | "paused";
  canPay: boolean;
  now?: number;
}) =>
  paymentRecoveryBanner({
    state,
    canPay,
    organizationName: "ACME",
    accessStopsAt: ACCESS_STOPS_AT,
    now,
  });

describe("paymentRecoveryBanner", () => {
  describe("when a payment failed", () => {
    it("tells a reader who can pay the date access stops, in orange", () => {
      expect(read({ state: "failing", canPay: true })).toEqual({
        status: "warning",
        title: "Your payment failed.",
        body: "Update your card by 30 November 2026 to keep your plan.",
        action: "Update card",
      });
    });

    it("turns red in the last week", () => {
      expect(read({ state: "failing", canPay: true, now: daysBeforeStop(7) })).toMatchObject({
        status: "error",
        body: "Access stops on 30 November 2026. Update your card to keep your plan.",
      });
    });

    it("says nothing to a plain member", () => {
      expect(read({ state: "failing", canPay: false })).toBeNull();
    });
  });

  describe("when the organization is paused", () => {
    it("gives a reader who can pay the Pay now button", () => {
      expect(read({ state: "paused", canPay: true })).toEqual({
        status: "error",
        title: "ACME is paused for non-payment.",
        body: "Free plan limits apply until the invoice is paid. Your data is safe.",
        action: "Pay now",
      });
    });

    it("tells a plain member to ask an admin, with no button", () => {
      expect(read({ state: "paused", canPay: false })).toEqual({
        status: "warning",
        title: "ACME is on Free plan limits for now.",
        body: "Ask an admin to update billing.",
        action: null,
      });
    });
  });

  it("says nothing once the invoice is paid", () => {
    expect(read({ state: "none", canPay: true })).toBeNull();
  });
});
