/**
 * The real PostHog channel: one client, built on the first send from ops'
 * product-analytics target, never at construction. No target, no client and
 * no send. @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createLogger } from "@langwatch/observability";
import type { ProductAnalyticsTarget } from "@langwatch/ops-contract";
import { PostHog } from "posthog-node";

import type { PostHogEventInput, PostHogEventsChannel } from "../posthog-events.channel.ts";

const logger = createLogger("langwatch:onboarding:posthog");

export interface HttpPostHogEventsOptions {
  readonly targets: () => ProductAnalyticsTarget[];
}

export class HttpPostHogEventsChannel implements PostHogEventsChannel {
  #clients: PostHog[] | undefined;

  private constructor(private readonly targets: () => ProductAnalyticsTarget[]) {}

  static create(options: HttpPostHogEventsOptions): HttpPostHogEventsChannel {
    return new HttpPostHogEventsChannel(options.targets);
  }

  track({ userId, event, properties }: PostHogEventInput): void {
    try {
      for (const client of this.clients()) {
        client.capture({ distinctId: userId, event, properties });
      }
    } catch (error) {
      logger.warn({ error, event }, "guided onboarding event did not reach PostHog");
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
