/**
 * Fetch policy for the trace behind a conversation turn: it lands a beat
 * after the messages that produced it, so the affordance retries rather
 * than concluding it doesn't exist. Immutable once written, so cache forever.
 */
export const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) => Math.min(2000 * 2 ** attemptIndex, 60000),
  staleTime: Infinity,
  gcTime: Infinity,
} as const;
