// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Billing's PostHog: one client per configured target, built on the first send, never at
 * construction.
 */
import { PostHog } from "posthog-node";

import {
  type BillingProductAnalyticsEvent,
  BillingProductAnalyticsChannel,
  type BillingProductAnalyticsTarget,
} from "../billing-product-analytics.channel.ts";

interface HttpBillingProductAnalyticsChannelOptions {
  readonly targets: () => BillingProductAnalyticsTarget[];
}

export class HttpBillingProductAnalyticsChannel extends BillingProductAnalyticsChannel {
  #clients: PostHog[] | undefined;

  private constructor(private readonly targets: () => BillingProductAnalyticsTarget[]) {
    super();
  }

  static create(
    options: HttpBillingProductAnalyticsChannelOptions,
  ): HttpBillingProductAnalyticsChannel {
    return new HttpBillingProductAnalyticsChannel(options.targets);
  }

  track({ userId, event, properties }: BillingProductAnalyticsEvent): void {
    for (const client of this.clients()) {
      client.capture({ distinctId: userId, event, properties });
    }
  }

  async close(): Promise<void> {
    await Promise.all((this.#clients ?? []).map((client) => client.shutdown()));
  }

  private clients(): PostHog[] {
    this.#clients ??= this.targets().map(
      (target) => new PostHog(target.key, target.host ? { host: target.host } : {}),
    );

    return this.#clients;
  }
}
