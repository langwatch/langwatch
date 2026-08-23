/**
 * Fetch policy for the trace behind a conversation turn.
 *
 * A trace lands a beat after the messages that produced it, so the affordance
 * that opens it has to retry rather than conclude the trace does not exist.
 * Traces are immutable once written, so caching forever is correct.
 */
export const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) =>
    Math.min(2000 * 2 ** attemptIndex, 60000),
  staleTime: Infinity,
  // Immutable, so it never needs refetching while it is on screen — but it
  // does not need keeping forever either. `gcTime: Infinity` held every trace
  // body a long session ever opened for as long as the tab lived; this frees
  // them five minutes after the last observer goes away.
  gcTime: 5 * 60 * 1000,
} as const;
