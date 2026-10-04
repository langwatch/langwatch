// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type BillingProductAnalyticsEvent,
  BillingProductAnalyticsChannel,
} from "../billing-product-analytics.channel.ts";

/** Keeps what was tracked, so suites assert on it without a network call. */
export class MemoryBillingProductAnalyticsChannel extends BillingProductAnalyticsChannel {
  readonly tracked: BillingProductAnalyticsEvent[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryBillingProductAnalyticsChannel {
    return new MemoryBillingProductAnalyticsChannel();
  }

  track(input: BillingProductAnalyticsEvent): void {
    this.tracked.push(input);
  }
}
