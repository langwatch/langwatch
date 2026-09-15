/**
 * The counter the hourly dispatch cap is kept in — a port, not a Redis
 * client, since a package cannot know what Redis a fleet shares. Shaped like
 * the application's `rateLimit`: `resetAt` feeds a refusal's `Retry-After`.
 */
export interface WebhookDispatchRateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

export abstract class WebhookDispatchRateLimiter {
  /** Counts one attempt against `key` and says whether it is inside `max` for the window. */
  abstract limit(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchRateLimitResult>;
}
