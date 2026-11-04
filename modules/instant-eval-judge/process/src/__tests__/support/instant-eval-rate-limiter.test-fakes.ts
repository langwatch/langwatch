import type {
  InstantEvalPermit,
  InstantEvalRateLimiter,
} from "../../channels/instant-eval-classifier.channel.ts";

/** A limiter for suites: never waits unless told to, and keeps every permit it was asked for. */
export class MemoryInstantEvalRateLimiter implements InstantEvalRateLimiter {
  readonly permits: InstantEvalPermit[] = [];

  private constructor(private readonly waitMs: number) {}

  static create({ waitMs = 0 }: { waitMs?: number } = {}): MemoryInstantEvalRateLimiter {
    return new MemoryInstantEvalRateLimiter(waitMs);
  }

  async acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void> {
    this.permits.push(permit);
    if (this.waitMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.waitMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
}
