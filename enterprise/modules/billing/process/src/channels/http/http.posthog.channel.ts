import { createLogger } from "@langwatch/observability";
import { PostHog } from "posthog-node";

import { PostHogChannel, type PostHogEventInput } from "../posthog.channel.ts";

const logger = createLogger("langwatch:billing:posthog");

export interface HttpPostHogChannelOptions {
  readonly key: string;
  readonly host?: string;
}

export class HttpPostHogChannel extends PostHogChannel {
  private constructor(private readonly client: PostHog) {
    super();
  }

  static create(options: HttpPostHogChannelOptions): HttpPostHogChannel {
    return new HttpPostHogChannel(
      new PostHog(options.key, options.host ? { host: options.host } : {}),
    );
  }

  track({ userId, event, properties }: PostHogEventInput): void {
    try {
      this.client.capture({ distinctId: userId, event, properties });
    } catch (error) {
      logger.warn({ error, event }, "billing milestone did not reach PostHog");
    }
  }

  async close(): Promise<void> {
    await this.client.shutdown();
  }
}
