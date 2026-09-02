/**
 * The counter the hourly dispatch cap is kept in.
 *
 * A port rather than a Redis client, because the cap has to hold across a fleet
 * and a package cannot know what that fleet shares. The application counts in
 * the Redis its app holds and falls back to a per-process map when there is
 * none; a background process composes the same two.
 *
 * The shape is deliberately the application's `rateLimit` signature rather than
 * a general counter: `resetAt` is what a refusal reports back as the caller's
 * `Retry-After`, and a limiter that answered only a boolean would turn a
 * legitimate burst's back-off into a guess.
 */
export interface WebhookDispatchRateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

export abstract class WebhookDispatchRateLimiterPort {
  /** Counts one attempt against `key` and says whether it is inside `max` for the window. */
  abstract limit(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchRateLimitResult>;
}
