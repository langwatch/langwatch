import type { InstantEvalRateLimiterChannel } from "../instant-eval-classifier.channel.ts";

/** A limiter that never waits, for suites. */
export class MemoryInstantEvalRateLimiterChannel implements InstantEvalRateLimiterChannel {
  private constructor() {}

  static create(): MemoryInstantEvalRateLimiterChannel {
    return new MemoryInstantEvalRateLimiterChannel();
  }

  async acquire(): Promise<void> {
    // Nothing is sent, so nothing has to be paced.
  }
}
