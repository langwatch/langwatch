// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProductAnalyticsChannel,
  ProductAnalyticsEvent,
} from "../product-analytics.channel.ts";

/** Holds every captured event, so a suite asserts on what was sent without a network. */
export class MemoryProductAnalyticsChannel implements ProductAnalyticsChannel {
  readonly captured: ProductAnalyticsEvent[] = [];

  private constructor() {}

  static create(): MemoryProductAnalyticsChannel {
    return new MemoryProductAnalyticsChannel();
  }

  capture(event: ProductAnalyticsEvent): void {
    this.captured.push(event);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
