/**
 * How many input tokens this deployment may send the judge per second, and
 * one tenant's share of that, paced over the shared buckets with a local
 * fallback. @see modules/instant-eval/specs/classifier.feature
 */

import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalPermit,
  InstantEvalRateLimiterChannel,
} from "../channels/instant-eval-judge.channel.ts";
import type {
  InstantEvalRateLimitBuckets,
  InstantEvalRateLimitRepository,
} from "../repositories/instant-eval-rate-limit.repository.ts";

const logger = createLogger("langwatch:instant-evals:rate-limiter");

/**
 * Input tokens a second a pod allows itself when Redis cannot be reached: a
 * fifth of the default global rate, safe to multiply by a handful of pods.
 */
export const LOCAL_FALLBACK_TOKENS_PER_SECOND = 60_000;

/** Never sleep longer than this in one go, so a cancelled query notices. */
const MAX_SLEEP_MS = 250;

/**
 * Longest one classification waits for capacity before it is let through to
 * be paced by the judge's own 429: a permit nobody can grant is a query that
 * has already failed, and waiting forever hides that from every caller.
 */
const MAX_WAIT_MS = 120_000;

interface InstantEvalRateLimiterOptions extends InstantEvalRateLimitBuckets {
  /** The shared buckets; when they cannot be reached the pod paces itself locally. */
  readonly buckets: InstantEvalRateLimitRepository;
  /** Input tokens a second the whole deployment may send. */
  readonly tokensPerSecond: number;
  /** Burst the global bucket may hold, above the rate so clock skew cannot stall it. */
  readonly capacity: number;
  readonly tenantTokensPerSecond: number;
  readonly tenantCapacity: number;
  /** Injected so a suite can drive the bucket without sleeping. */
  readonly now?: () => Instant;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class InstantEvalRateLimiterService implements InstantEvalRateLimiterChannel {
  private localTokens: number;
  private localAt: number;
  private readonly now: () => Instant;
  private readonly sleep: (ms: number) => Promise<void>;

  private constructor(private readonly options: InstantEvalRateLimiterOptions) {
    this.now = options.now ?? nowInstant;
    this.sleep = options.sleep ?? defaultSleep;
    this.localTokens = LOCAL_FALLBACK_TOKENS_PER_SECOND;
    this.localAt = this.now().epochMilliseconds;
  }

  static create(options: InstantEvalRateLimiterOptions): InstantEvalRateLimiterService {
    return new InstantEvalRateLimiterService(options);
  }

  async acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void> {
    // Never more than the bucket can hold, or the request waits forever for a
    // fill that never comes; a request past the capacity is one the judge
    // would refuse anyway, so it is let through to be refused.
    const wanted = Math.max(
      1,
      Math.min(Math.ceil(permit.tokens), this.options.capacity, this.options.tenantCapacity),
    );
    const deadline = this.now().epochMilliseconds + MAX_WAIT_MS;
    while (this.now().epochMilliseconds < deadline) {
      signal?.throwIfAborted();
      const waitMs = await this.draw({ wanted, tenantId: permit.tenantId });
      if (waitMs === 0) return;
      await this.sleep(Math.min(waitMs, MAX_SLEEP_MS));
    }
  }

  /** Takes the tokens, or answers with how long the buckets need. */
  private async draw({ wanted, tenantId }: { wanted: number; tenantId: string }): Promise<number> {
    try {
      return await this.options.buckets.take({
        wanted,
        tenantId,
        nowMs: this.now().epochMilliseconds,
        buckets: {
          tokensPerSecond: this.options.tokensPerSecond,
          capacity: this.options.capacity,
          tenantTokensPerSecond: this.options.tenantTokensPerSecond,
          tenantCapacity: this.options.tenantCapacity,
        },
      });
    } catch (error) {
      logger.warn(
        { error },
        "Instant Evals rate limiter could not reach Redis; falling back to the local rate",
      );
      return this.drawLocally(wanted);
    }
  }

  /**
   * The pod's own bucket, refilled the same way as the shared one, so a Redis
   * outage is a slowdown rather than a different feature.
   */
  private drawLocally(wanted: number): number {
    const now = this.now().epochMilliseconds;
    const elapsedSeconds = Math.max(0, now - this.localAt) / 1000;
    this.localTokens = Math.min(
      LOCAL_FALLBACK_TOKENS_PER_SECOND,
      this.localTokens + elapsedSeconds * LOCAL_FALLBACK_TOKENS_PER_SECOND,
    );
    this.localAt = now;
    const needed = Math.min(wanted, LOCAL_FALLBACK_TOKENS_PER_SECOND);
    if (this.localTokens >= needed) {
      this.localTokens -= needed;
      return 0;
    }
    return Math.ceil(((needed - this.localTokens) / LOCAL_FALLBACK_TOKENS_PER_SECOND) * 1000);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
