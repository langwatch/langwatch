/**
 * Scenario execution configuration constants.
 *
 * All magic values extracted to named constants for clarity and maintainability.
 */

/** Child process configuration */
export const CHILD_PROCESS = {
  /** Timeout for scenario child process execution (ms) */
  TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
} as const;
