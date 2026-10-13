// CLI first-trace polling policy: pure functions; separate from component (first-trace-redirect)
// and state hook (use-first-trace-watch) so policy is unit-testable.
// Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature

export const FIRST_TRACE_POLL_TIMEOUT_MS = 10 * 60_000;
export const FIRST_TRACE_REDIRECT_DELAY_MS = 1_200;

// Watch policy: reads while a project exists and the watch hasn't concluded.
export function resolveFirstTracePolling({
  hasProject,
  isRedirecting,
  isTimedOut,
  hasPriorTraces,
}: {
  hasProject: boolean;
  isRedirecting: boolean;
  isTimedOut: boolean;
  hasPriorTraces: boolean;
}): { enabled: boolean } {
  const enabled = hasProject && !isRedirecting && !isTimedOut && !hasPriorTraces;
  return { enabled };
}

/**
 * Pure transition policy for a first-trace read landing: confirm the
 * never-synced state, mark prior traces, or start the redirect. A
 * response landing after the watch timed out must never start a redirect.
 */
export function resolveFirstTraceTransition({
  firstMessage,
  hasSeenNeverSynced,
  isTimedOut,
}: {
  firstMessage: boolean | undefined;
  hasSeenNeverSynced: boolean;
  isTimedOut: boolean;
}): "none" | "confirm-never-synced" | "mark-prior-traces" | "redirect" {
  if (firstMessage === undefined) return "none";
  if (!firstMessage) {
    return hasSeenNeverSynced ? "none" : "confirm-never-synced";
  }
  if (!hasSeenNeverSynced) return "mark-prior-traces";
  if (isTimedOut) return "none";
  return "redirect";
}
