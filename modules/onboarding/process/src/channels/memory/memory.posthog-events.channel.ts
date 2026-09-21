/**
 * The channel a deployment without a PostHog key gets, and suites use to
 * assert on what was tracked without a network call.
 */
import type { PostHogEventInput, PostHogEventsChannel } from "../posthog-events.channel.ts";

export class MemoryPostHogEventsChannel implements PostHogEventsChannel {
  readonly tracked: PostHogEventInput[] = [];

  private constructor() {}

  static create(): MemoryPostHogEventsChannel {
    return new MemoryPostHogEventsChannel();
  }

  track(input: PostHogEventInput): void {
    this.tracked.push(input);
  }
}
