/**
 * When the CLI onboarding watch polls for the first trace, and what a landing
 * read means.
 *
 * The pure half of `platform/app/src/pages/cli/FirstTraceRedirect.tsx`. The
 * component that drives it is `ui/sections/first-trace-redirect.tsx` and the
 * hook that holds its state is `behavior/use-first-trace-watch.ts`; these two
 * functions decide, and having them here is what lets the policy be a unit test
 * rather than a timer-driven render.
 *
 * Behaviour rules: specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

export const FIRST_TRACE_POLL_INTERVAL_MS = 3_000;
export const FIRST_TRACE_POLL_TIMEOUT_MS = 10 * 60_000;
export const FIRST_TRACE_REDIRECT_DELAY_MS = 1_200;

/**
 * Pure polling policy: the query runs only while there is a project to watch
 * and nothing has concluded the watch (redirect underway, timeout reached, or
 * the project already had traces). The refetch interval additionally requires
 * either a confirmed never-synced state or no result yet, so a failed
 * initial read keeps retrying until the timeout instead of stalling.
 * Hidden tabs are covered by react-query itself: with the default
 * refetchIntervalInBackground (false), an interval query only ticks while
 * the tab is focused per the focus manager's visibilitychange handling.
 */
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
