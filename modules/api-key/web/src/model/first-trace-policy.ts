// CLI first-trace polling policy: pure functions; separate from component (first-trace-redirect)
// and state hook (use-first-trace-watch) so policy is unit-testable.
// Spec: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature

export const FIRST_TRACE_POLL_INTERVAL_MS = 3_000;
export const FIRST_TRACE_POLL_TIMEOUT_MS = 10 * 60_000;
export const FIRST_TRACE_REDIRECT_DELAY_MS = 1_200;

// Polling policy: runs while project exists and watch hasn't concluded. Retry on failed reads;
// react-query handles hidden tabs.
export function resolveFirstTracePolling({
  hasProject,
  hasResult,
  isRedirecting,
  isTimedOut,
  hasPriorTraces,
  hasSeenNeverSynced,
}: {
  hasProject: boolean;
  hasResult: boolean;
  isRedirecting: boolean;
  isTimedOut: boolean;
  hasPriorTraces: boolean;
  hasSeenNeverSynced: boolean;
}): { enabled: boolean; refetchInterval: number | false } {
  const enabled = hasProject && !isRedirecting && !isTimedOut && !hasPriorTraces;
  const refetchInterval =
    enabled && (hasSeenNeverSynced || !hasResult) ? FIRST_TRACE_POLL_INTERVAL_MS : false;
  return { enabled, refetchInterval };
}

/**
 * Pure transition policy for a first-trace read landing: confirm the
 * never-synced state, mark prior traces (which keeps the current behavior),
 * or start the redirect. A response that lands after the watch timed out
 * must not start a redirect, however late the network was.
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
