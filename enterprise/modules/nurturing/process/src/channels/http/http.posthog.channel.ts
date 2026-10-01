/**
 * Nurturing's PostHog: one client per configured target, built on the first send, never at
 * construction. No target, no client and no send, as main's `trackServerEvent` without a key.
 */
import { createLogger } from "@langwatch/observability";
import { PostHog } from "posthog-node";

import {
  PostHogChannel,
  type PostHogEventInput,
  type PostHogGroupInput,
  type ProductAnalyticsTarget,
} from "../posthog.channel.ts";

const logger = createLogger("langwatch:nurturing:posthog");

interface HttpPostHogChannelOptions {
  readonly targets: () => ProductAnalyticsTarget[];
}

export class HttpPostHogChannel extends PostHogChannel {
  #clients: PostHog[] | undefined;

  private constructor(private readonly targets: () => ProductAnalyticsTarget[]) {
    super();
  }

  static create(options: HttpPostHogChannelOptions): HttpPostHogChannel {
    return new HttpPostHogChannel(options.targets);
  }

  track({ userId, event, properties }: PostHogEventInput): void {
    try {
      for (const client of this.clients()) {
        client.capture({ distinctId: userId, event, properties });
      }
    } catch (error) {
      logger.warn({ error, event }, "a product milestone did not reach PostHog");
    }
  }

  groupIdentify({ groupType, groupKey, properties }: PostHogGroupInput): void {
    try {
      for (const client of this.clients())
        client.groupIdentify({ groupType, groupKey, properties });
    } catch (error) {
      logger.warn({ error, groupType }, "a group's properties did not reach PostHog");
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
