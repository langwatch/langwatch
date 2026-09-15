import type { CodingAgentSessionState } from "../../projections/coding-agent-session.projection.ts";
import { CodingAgentSessionStateProjection } from "../../projections/coding-agent-session-state.projection.ts";

// Folded session initialized from projection's init state to prevent
// composition tests from restating counters or silently dropping mapper changes.
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
