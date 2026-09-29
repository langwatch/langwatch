import {
  PostHogChannel,
  type PostHogEventInput,
  type PostHogGroupInput,
} from "../posthog.channel.ts";

/**
 * The channel a deployment without a PostHog key gets, and suites use to
 * assert on what was tracked without a network call.
 */
export class MemoryPostHogChannel extends PostHogChannel {
  readonly tracked: PostHogEventInput[] = [];
  readonly groups: PostHogGroupInput[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryPostHogChannel {
    return new MemoryPostHogChannel();
  }

  track(input: PostHogEventInput): void {
    this.tracked.push(input);
  }

  groupIdentify(input: PostHogGroupInput): void {
    this.groups.push(input);
  }
}
