// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HandledError } from "@langwatch/handled-error";
import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/** Pinned: the checkout-volume alert reads this series by name. */
const BILLING_CHECKOUT_TOTAL_METRIC_NAME = "billing_checkout_total";

/** Which door the checkout came through. */
export type BillingCheckoutFlow = "subscription" | "seat_checkout";

/**
 * Counts checkouts started, refused and completed. A missing upgrade button
 * throws nothing and logs nothing; the only trace it leaves is starts going quiet.
 */
export class BillingCheckoutMeterService {
  static create(checkouts: CounterHandle = defaultCounter()): BillingCheckoutMeterService {
    return new BillingCheckoutMeterService(checkouts);
  }

  private constructor(private readonly checkouts: CounterHandle) {}

  /** Runs one checkout request: a URL answered is a start, anything else a failure by code. */
  async track<T extends { url: string | null }>(
    flow: BillingCheckoutFlow,
    request: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await request();
    } catch (error) {
      this.checkouts.inc({ stage: "failed", flow, code: failureCode(error) });
      throw error;
    }
    if (result.url) {
      this.checkouts.inc({ stage: "started", flow });
    } else {
      this.checkouts.inc({ stage: "failed", flow, code: "no_checkout_url" });
    }
    return result;
  }

  completed(): void {
    this.checkouts.inc({ stage: "completed" });
  }
}

function failureCode(error: unknown): string {
  return error instanceof HandledError ? error.code : "unhandled";
}

function defaultCounter(): CounterHandle {
  return counter({
    name: BILLING_CHECKOUT_TOTAL_METRIC_NAME,
    description: "Billing checkouts by stage (started, failed, completed), flow and failure code",
  });
}
