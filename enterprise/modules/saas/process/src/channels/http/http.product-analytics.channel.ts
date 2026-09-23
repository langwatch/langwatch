// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Logger } from "@langwatch/observability";
import type { ProductAnalyticsTarget } from "@langwatch/ops-contract";
import { PostHog } from "posthog-node";

import type {
  ProductAnalyticsChannel,
  ProductAnalyticsEvent,
} from "../product-analytics.channel.ts";

/** PostHog, one client per target ops names, built on the first capture. No target, no send. */
export class HttpProductAnalyticsChannel implements ProductAnalyticsChannel {
  readonly #targets: () => ProductAnalyticsTarget[];
  readonly #logger: Logger;
  #clients: PostHog[] | undefined;

  private constructor(targets: () => ProductAnalyticsTarget[], logger: Logger) {
    this.#targets = targets;
    this.#logger = logger;
  }

  static create({
    targets,
    logger,
  }: {
    targets: () => ProductAnalyticsTarget[];
    logger: Logger;
  }): HttpProductAnalyticsChannel {
    return new HttpProductAnalyticsChannel(targets, logger);
  }

  capture({ distinctId, event, properties }: ProductAnalyticsEvent): void {
    try {
      for (const client of this.#clientsOnce()) {
        client.capture({ distinctId, event, properties: { ...properties } });
      }
    } catch (error) {
      this.#logger.warn({ error, event }, "a Cloud product-analytics event did not reach PostHog");
    }
  }

  async close(): Promise<void> {
    await Promise.all((this.#clients ?? []).map((client) => client.shutdown()));
  }

  #clientsOnce(): PostHog[] {
    this.#clients ??= this.#targets().map(
      (target) => new PostHog(target.key, target.host ? { host: target.host } : {}),
    );

    return this.#clients;
  }
}
