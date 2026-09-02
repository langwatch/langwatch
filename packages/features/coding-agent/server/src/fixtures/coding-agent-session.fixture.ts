import type { CodingAgentSessionState } from "../projections/coding-agent-session.projection";
import { CodingAgentSessionStateProjection } from "../projections/coding-agent-session-state.projection";

/**
 * One folded session, initialised the way the fold itself initialises it.
 *
 * Built from the projection's own initial state rather than spelled out, so a
 * composition test outside this package can drive a real store call without
 * restating thirty counters — and without silently dropping the one a mapper
 * added last week, which is a crash rather than a stale expectation.
 *
 * The default carries a model call because the store drops a session with no
 * persistable signal at all, by design.
 */
export function codingAgentSessionFoldState(
  overrides: Partial<CodingAgentSessionState> = {},
): CodingAgentSessionState {
  return {
    ...CodingAgentSessionStateProjection.create().createInitCodingAgentSession(),
    sessionId: "session_1",
    agent: "claude_code",
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 5,
    sessionKeySource: "provider",
    traceIds: ["trace_1"],
    startedAtMs: 1_800_000_000_000,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_500,
    LastEventOccurredAt: 1_800_000_000_400,
    ...overrides,
  } as CodingAgentSessionState;
}
