/**
 * A routed leg's provider timeout, kept apart from the caller's stop.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import { nowInstant } from "@langwatch/time";

import type { InstantEvalRateLimiter } from "../channels/instant-eval-classifier.channel.ts";

/**
 * A leg's provider timeout, apart from the caller's stop. Its clock runs only while the leg is
 * with the provider: waiting on a rate limiter pauses it, so queueing never times a leg out.
 */
export class InstantEvalJudgeLegDeadlineService {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private startedAtMs = 0;
  private isStopped = false;

  private constructor(private remainingMs: number) {}

  /** Starts the clock at once: a leg's deadline exists only while the leg runs. */
  static create(timeoutMs: number): InstantEvalJudgeLegDeadlineService {
    const deadline = new InstantEvalJudgeLegDeadlineService(timeoutMs);
    deadline.resume();
    return deadline;
  }

  /** What the channel is handed: the leg's timeout, and the caller's stop when there is one. */
  signalWith(caller: AbortSignal | undefined): AbortSignal {
    const own = this.controller.signal;
    return caller ? AbortSignal.any([caller, own]) : own;
  }

  pausing({
    limiter,
    signal,
  }: {
    limiter: InstantEvalRateLimiter;
    signal: AbortSignal | undefined;
  }): InstantEvalRateLimiter {
    return {
      acquire: async (permit) => {
        this.pause();
        try {
          await limiter.acquire(permit, signal);
        } finally {
          this.resume();
        }
      },
    };
  }

  stop(): void {
    this.isStopped = true;
    this.clear();
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private pause(): void {
    if (this.timer === undefined) return;
    this.clear();
    this.remainingMs -= nowInstant().epochMilliseconds - this.startedAtMs;
  }

  private resume(): void {
    if (this.isStopped || this.controller.signal.aborted || this.timer !== undefined) return;
    this.startedAtMs = nowInstant().epochMilliseconds;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.controller.abort(new DOMException("The routed leg timed out", "TimeoutError"));
      },
      Math.max(0, this.remainingMs),
    );
  }
}
