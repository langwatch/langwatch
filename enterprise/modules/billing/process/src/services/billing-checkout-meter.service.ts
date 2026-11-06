// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HandledError } from "@langwatch/handled-error";
import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/** Pinned: the checkout-volume alert reads this series by name. */
export const BILLING_CHECKOUT_TOTAL_METRIC_NAME = "billing_checkout_total";

/** Which door the checkout came through. */
const BILLING_CHECKOUT_FLOWS = ["subscription", "seat_checkout"] as const;
export type BillingCheckoutFlow = (typeof BILLING_CHECKOUT_FLOWS)[number];

/**
 * Counts checkouts started, refused and completed. A missing upgrade button
 * throws nothing and logs nothing; the only trace it leaves is starts going quiet.
 */
export class BillingCheckoutMeterService {
  static create(): BillingCheckoutMeterService {
    return new BillingCheckoutMeterService(
      counter({
        name: BILLING_CHECKOUT_TOTAL_METRIC_NAME,
        description:
          "Billing checkouts by stage (started, failed, completed), flow and failure reason",
      }),
    );
  }

  private constructor(private readonly checkouts: CounterHandle) {}

  /** Runs one checkout request: a payment page answered is a start, anything else a failure. */
  async track<T extends { url: string | null }>(
    flow: BillingCheckoutFlow,
    request: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await request();
    } catch (error) {
      this.checkouts.inc({ stage: "failed", flow, reason: failureReason(error) });
      throw error;
    }
    if (result.url) {
      this.checkouts.inc({ stage: "started", flow });
    } else {
      this.checkouts.inc({ stage: "failed", flow, reason: "no_checkout_url" });
    }
    return result;
  }

  /** Writes zero starts per flow, so a door nobody reaches still exports a series to alert on. */
  seedStarts(): void {
    for (const flow of BILLING_CHECKOUT_FLOWS) this.checkouts.inc({ stage: "started", flow }, 0);
  }

  completed(): void {
    this.checkouts.inc({ stage: "completed" });
  }
}

function failureReason(error: unknown): string {
  return error instanceof HandledError ? error.code : "unhandled";
}
