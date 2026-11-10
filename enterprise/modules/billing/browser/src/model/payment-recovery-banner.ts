/**
 * What the shell's payment banner says for each recovery state and reader
 * (enterprise/modules/billing/specs/payment-recovery.feature).
 */

import type { PaymentRecoveryState } from "@langwatch/enterprise-billing-contract";
import { format, Temporal } from "@langwatch/time";

const FINAL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type PaymentRecoveryBannerCopy = {
  status: "warning" | "error";
  title: string;
  body: string;
  /** The button's label; null for a reader who cannot pay. */
  action: "Update card" | "Pay now" | null;
};

/** The banner for one reader, or null when there is nothing to say to them. */
export function paymentRecoveryBanner({
  state,
  canPay,
  organizationName,
  accessStopsAt,
  now,
}: {
  state: PaymentRecoveryState;
  canPay: boolean;
  organizationName: string;
  /** ISO instant of the move to the Free plan, when the reader may read the case's details. */
  accessStopsAt: string | null;
  /** Epoch milliseconds. */
  now: number;
}): PaymentRecoveryBannerCopy | null {
  if (state === "paused") {
    return canPay
      ? {
          status: "error",
          title: "You're on the Free plan now.",
          body: "Traces over the limit aren't being saved. Update your card to get Growth back.",
          action: "Pay now",
        }
      : {
          status: "warning",
          title: `${organizationName} is on the Free plan now.`,
          body: "Traces over the limit aren't being saved. Ask an admin to update billing.",
          action: null,
        };
  }
  if (state !== "failing" || !canPay) return null;
  if (accessStopsAt === null) {
    return {
      status: "warning",
      title: "Your payment failed.",
      body: "Update your card to keep your plan.",
      action: "Update card",
    };
  }
  const stopsOn = format(accessStopsAt, "d MMMM yyyy", { timeZone: "UTC" });
  const isFinalWeek = Temporal.Instant.from(accessStopsAt).epochMilliseconds - now <= FINAL_WEEK_MS;
  return {
    status: isFinalWeek ? "error" : "warning",
    title: "Your payment failed.",
    body: isFinalWeek
      ? `On ${stopsOn} you move to the Free plan. Traces over the limit will stop being saved. Existing data stays stored.`
      : `Update your card by ${stopsOn} to keep your plan.`,
    action: "Update card",
  };
}
