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
  gcTime: Infinity,
} as const;
