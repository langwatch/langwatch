import type {
  CodingAgentSessionIdentityState,
  IdentitySlot,
  SessionKeySource,
} from "./schema";

/**
 * The one session-id resolution: the agent's own conversation key when the
 * telemetry carries one, otherwise the trace id, otherwise nothing. Resolving
 * it per signal type instead splits one real session into two aggregates
 * whose numbers never join.
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

/**
 * Applies a contribution's `agent`/`sessionKeySource` as one atomic
 * last-write-wins replace against `acceptedAt` — our own stamp, never the
 * customer's `occurredAt` (ADR-099). Both are required on every contribution,
 * so replacing them together can never blank either.
 */
export function applyIdentity(
  state: CodingAgentSessionIdentityState,
  incoming: {
    agent: string;
    sessionKeySource: SessionKeySource;
    acceptedAt: number;
  },
): CodingAgentSessionIdentityState {
  if (incoming.acceptedAt < state.identityAcceptedAt) return state;
  return {
    ...state,
    agent: incoming.agent,
    sessionKeySource: incoming.sessionKeySource,
    identityAcceptedAt: incoming.acceptedAt,
  };
}

/**
 * Applies one sparse identity slot (`terminalType`, `userId`, …) as
 * last-write-wins against its own stamp. `incomingValue === null` means this
 * contribution carries no opinion, never a request to blank the slot.
 */
export function applyIdentitySlot(
  slot: IdentitySlot,
  incomingValue: string | null,
  incomingAcceptedAt: number,
): IdentitySlot {
  if (incomingValue === null || incomingValue === "") return slot;
  if (incomingAcceptedAt < slot.acceptedAt) return slot;
  return { value: incomingValue, acceptedAt: incomingAcceptedAt };
}

/** `Math.min`, with `0` treated as "unset" rather than a real minimum. Commutative — no stamp needed. */
export function applyStartedAtMs(current: number, incomingMs: number): number {
  if (current === 0) return incomingMs;
  return Math.min(current, incomingMs);
}
