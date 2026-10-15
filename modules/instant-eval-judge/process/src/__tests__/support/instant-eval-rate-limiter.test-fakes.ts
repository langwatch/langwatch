import type { InstantEvalRateLimiter } from "../../channels/instant-eval-classifier.channel.ts";

/** A limiter that never waits, for suites. */
export class MemoryInstantEvalRateLimiter implements InstantEvalRateLimiter {
  private constructor() {}

  static create(): MemoryInstantEvalRateLimiter {
    return new MemoryInstantEvalRateLimiter();
  }

  async acquire(): Promise<void> {
    // Nothing is sent, so nothing has to be paced.
  }
}
