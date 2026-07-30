import type { SessionKeySource } from "./schema";

/**
 * The one session-id resolution: the agent's own conversation key when the
 * telemetry carries one, otherwise the trace id, otherwise nothing. Resolving
 * it per signal type instead splits one real session into two aggregates whose
 * numbers never join. Used by `bridge/dispatch.ts`, upstream of the fold.
 */
export function resolveCodingAgentSessionId(args: {
  readonly providerSessionKey: string | null;
  readonly traceId: string | null;
}): {
  readonly sessionId: string;
  readonly sessionKeySource: SessionKeySource;
} | null {
  if (args.providerSessionKey !== null) {
    return { sessionId: args.providerSessionKey, sessionKeySource: "provider" };
  }
  if (args.traceId !== null) {
    return { sessionId: args.traceId, sessionKeySource: "trace_fallback" };
  }
  return null;
}
