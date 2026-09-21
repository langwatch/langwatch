/**
 * The real PostHog channel: one client, shared across every call this
 * process makes. `key`/`host` are plain config, not a secret — the browser
 * ships the same project key. @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createLogger } from "@langwatch/observability";
import { PostHog } from "posthog-node";

import type { PostHogEventInput, PostHogEventsChannel } from "../posthog-events.channel.ts";

const logger = createLogger("langwatch:onboarding:posthog");

export interface HttpPostHogEventsOptions {
  readonly key: string;
  readonly host?: string;
}

export class HttpPostHogEventsChannel implements PostHogEventsChannel {
  private constructor(private readonly client: PostHog) {}

  static create(options: HttpPostHogEventsOptions): HttpPostHogEventsChannel {
    return new HttpPostHogEventsChannel(
      new PostHog(options.key, options.host ? { host: options.host } : {}),
    );
  }

  track({ userId, event, properties }: PostHogEventInput): void {
    try {
      this.client.capture({ distinctId: userId, event, properties });
    } catch (error) {
      logger.warn({ error, event }, "guided onboarding event did not reach PostHog");
    }
  }

  async close(): Promise<void> {
    await this.client.shutdown();
  }
}
