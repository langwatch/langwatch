/**
 * Configuration for exponential backoff when events are not yet visible.
 */
export interface ExponentialBackoffConfig {
  /** Initial delay for first retry */
  baseDelayMs: number;
  /** Multiplier for exponential growth */
  multiplier: number;
  /** Maximum delay cap */
  maxDelayMs: number;
}

/**
 * Default configuration for exponential backoff (ClickHouse replication lag).
 */
export const DEFAULT_EXPONENTIAL_BACKOFF_CONFIG: ExponentialBackoffConfig = {
  baseDelayMs: 2000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;

/**
 * Calculates exponential backoff delay for "no events found" errors.
 * Used when events aren't yet visible due to replication lag.
 *
 * @param attemptsStarted - Number of attempts started (includes current attempt)
 * @param config - Backoff configuration parameters
 * @returns Delay in milliseconds
 */
export function calculateExponentialBackoff(
  attemptsStarted: number,
  config: ExponentialBackoffConfig = DEFAULT_EXPONENTIAL_BACKOFF_CONFIG,
): number {
  // attemptsStarted includes the current attempt; we want completed attempts for backoff
  const completedAttempts = Math.max(0, attemptsStarted - 1);
  const delay = config.baseDelayMs * config.multiplier ** completedAttempts;

  return Math.min(delay, config.maxDelayMs);
}
