/**
 * Configuration for progressive delay calculation when handling ordering errors.
 * Higher sequence numbers wait longer, giving earlier events priority.
 */
export interface ProgressiveDelayConfig {
  /** Base delay before any sequence-based adjustment */
  baseDelayMs: number;
  /** Additional delay per sequence number position */
  perSequenceDelayMs: number;
  /** Additional delay per retry attempt */
  perAttemptDelayMs: number;
  /** Maximum delay cap to prevent excessive waits */
  maxDelayMs: number;
}

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
 * Configuration for lock contention delay.
 */
export interface LockContentionDelayConfig {
  /** Initial delay - short to handle quick lock releases */
  baseDelayMs: number;
  /** Additional delay per retry attempt */
  perAttemptDelayMs: number;
  /** Maximum delay cap */
  maxDelayMs: number;
}

/**
 * Default configuration for progressive delay calculation.
 * Short delays since we're polling for the previous event's checkpoint.
 */
export const DEFAULT_PROGRESSIVE_DELAY_CONFIG: ProgressiveDelayConfig = {
  baseDelayMs: 100,
  perSequenceDelayMs: 50,
  perAttemptDelayMs: 50,
  maxDelayMs: 5000,
} as const;

/**
 * Default configuration for exponential backoff (ClickHouse replication lag).
 */
export const DEFAULT_EXPONENTIAL_BACKOFF_CONFIG: ExponentialBackoffConfig = {
  baseDelayMs: 2000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;

/**
 * Default configuration for lock contention delay.
 */
export const DEFAULT_LOCK_CONTENTION_DELAY_CONFIG: LockContentionDelayConfig = {
  baseDelayMs: 2000,
  perAttemptDelayMs: 3000,
  maxDelayMs: 30000,
} as const;

/**
 * Calculates a progressive delay based on sequence position and attempts.
 * Higher sequence numbers wait longer, giving earlier events priority to process first.
 *
 * @param previousSequence - The sequence number of the previous event (null if unknown)
 * @param attemptsStarted - Number of attempts started (includes current attempt)
 * @param config - Delay configuration parameters
 * @returns Delay in milliseconds
 */
export function calculateProgressiveDelay(
  previousSequence: number | null,
  attemptsStarted: number,
  config: ProgressiveDelayConfig = DEFAULT_PROGRESSIVE_DELAY_CONFIG,
): number {
  const currentSequence = (previousSequence ?? 0) + 1;
  // attemptsStarted includes the current attempt; we want completed attempts for backoff
  const completedAttempts = Math.max(0, attemptsStarted - 1);

  const sequenceBasedDelay =
    config.baseDelayMs + currentSequence * config.perSequenceDelayMs;
  const attemptBasedDelay = completedAttempts * config.perAttemptDelayMs;

  return Math.min(sequenceBasedDelay + attemptBasedDelay, config.maxDelayMs);
}

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

/**
 * Calculates delay for lock contention errors.
 * Uses progressive delays since the lock holder will process all unprocessed events.
 *
 * @param attemptsStarted - Number of attempts started (includes current attempt)
 * @param config - Lock contention delay configuration
 * @returns Delay in milliseconds
 */
export function calculateLockContentionDelay(
  attemptsStarted: number,
  config: LockContentionDelayConfig = DEFAULT_LOCK_CONTENTION_DELAY_CONFIG,
): number {
  // attemptsStarted includes the current attempt; we want completed attempts for backoff
  const completedAttempts = Math.max(0, attemptsStarted - 1);
  const delay = config.baseDelayMs + completedAttempts * config.perAttemptDelayMs;

  return Math.min(delay, config.maxDelayMs);
}
