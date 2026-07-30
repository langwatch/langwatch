import {
  type AggregateEvent,
  checkOrderInvariance,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { codingAgentSession } from "../aggregate";
import type { CodingAgentSessionIdentityState } from "../schema";

/** `specs/coding-agent/session-aggregate.feature` is the behaviour contract. */

const TENANT = "tenant-1";
const SESSION = "session-1";

function spanEvent(
  overrides: Partial<Record<string, unknown>> = {},
): AggregateEvent {
  return {
    type: "coding_agent_session/spanFactsContributed",
    data: {
      tenantId: TENANT,
      sessionId: SESSION,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: 1_000,
      acceptedAt: 1_000,
      traceId: "trace-1",
      spanId: "span-1",
      name: "claude_code.tool",
      startTimeUnixMs: 1_000,
      endTimeUnixMs: 1_100,
      statusCode: 1,
      facts: {},
      scopeName: "anthropic",
      ...overrides,
    },
  };
}

function logEvent(
  overrides: Partial<Record<string, unknown>> = {},
): AggregateEvent {
  return {
    type: "coding_agent_session/logFactsContributed",
    data: {
      tenantId: TENANT,
      sessionId: SESSION,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: 2_000,
      acceptedAt: 2_000,
      recordId: "record-1",
      traceId: null,
      spanId: null,
      timeUnixMs: 2_000,
      severityNumber: null,
      providerKind: "anthropic",
      scopeName: "anthropic",
      facts: {},
      ...overrides,
    },
  };
}

function metricEvent(
  overrides: Partial<Record<string, unknown>> = {},
): AggregateEvent {
  return {
    type: "coding_agent_session/metricFactsContributed",
    data: {
      tenantId: TENANT,
      sessionId: SESSION,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: 3_000,
      acceptedAt: 3_000,
      seriesId: "series-1",
      metricName: "claude_code.lines_of_code.count",
      unit: null,
      attributes: {},
      value: 10,
      dataPointCount: 1,
      asOfUnixMs: 3_000,
      ...overrides,
    },
  };
}

describe("given the coding_agent_session aggregate", () => {
  describe("when a span, a log and a metric contribution all fold", () => {
    it("folds all three signals into one session identity", () => {
      let state = codingAgentSession.init();
      state = codingAgentSession.apply(state, spanEvent());
      state = codingAgentSession.apply(state, logEvent());
      state = codingAgentSession.apply(state, metricEvent());

      expect(state.agent).toBe("claude_code");
      expect(state.sessionKeySource).toBe("provider");
      expect(state.startedAtMs).toBe(1_000);
    });
  });

  describe("when a later contribution carries better agent evidence", () => {
    /** @scenario "a Cowork session is an agent session" */
    it("replaces the agent label when a later-accepted contribution disagrees", () => {
      let state = codingAgentSession.init();
      state = codingAgentSession.apply(
        state,
        spanEvent({ agent: "claude_code", acceptedAt: 1_000 }),
      );
      // A later-accepted log contribution correctly identifies Cowork via
      // its resource service name. This is the direct fix for "the
      // agent/sessionKeySource mislabelling… first-write-wins with no
      // stamp": the OLD fold's `state.agent ?? data.agent` could never let
      // this contribution win. This one can, because it compares stamps.
      state = codingAgentSession.apply(
        state,
        logEvent({ agent: "claude_cowork", acceptedAt: 2_000 }),
      );

      expect(state.agent).toBe("claude_cowork");
    });

    it("keeps the newer label even when the older event folds AFTER it (order-invariance)", () => {
      let state = codingAgentSession.init();
      // Reversed fold order from the test above: the newer-stamped
      // contribution folds FIRST.
      state = codingAgentSession.apply(
        state,
        logEvent({ agent: "claude_cowork", acceptedAt: 2_000 }),
      );
      state = codingAgentSession.apply(
        state,
        spanEvent({ agent: "claude_code", acceptedAt: 1_000 }),
      );

      expect(state.agent).toBe("claude_cowork");
    });
  });

  describe("when a sparse identity fact is absent from a later contribution", () => {
    it("never blanks a value a previous contribution established", () => {
      let state = codingAgentSession.init();
      state = codingAgentSession.apply(
        state,
        logEvent({
          acceptedAt: 1_000,
          facts: { "terminal.type": "vscode" },
        }),
      );
      // A metric contribution carries none of the sparse identity slots, so
      // it must not blank `terminalType`.
      state = codingAgentSession.apply(
        state,
        metricEvent({ acceptedAt: 2_000 }),
      );

      expect(state.terminalType.value).toBe("vscode");
    });
  });

  describe("when telemetry is re-delivered", () => {
    /** @scenario "re-delivered telemetry does not inflate a session" */
    it("re-applying the identical contribution changes nothing", () => {
      let state = codingAgentSession.init();
      const event = spanEvent();
      state = codingAgentSession.apply(state, event);
      const once = state;
      state = codingAgentSession.apply(state, event);

      expect(state).toEqual(once);
    });
  });

  describe("when a session's earliest signal arrives late", () => {
    /** @scenario "a session whose earliest signal arrives late is listed once, up to date" */
    it("moves startedAtMs backwards without needing a stamp, regardless of arrival order", () => {
      let state = codingAgentSession.init();
      state = codingAgentSession.apply(
        state,
        spanEvent({ startTimeUnixMs: 5_000 }),
      );
      expect(state.startedAtMs).toBe(5_000);

      // An earlier-starting span, delivered later.
      state = codingAgentSession.apply(
        state,
        spanEvent({ startTimeUnixMs: 1_000, spanId: "span-2" }),
      );
      expect(state.startedAtMs).toBe(1_000);
    });
  });

  describe("when the event set is checked for order-invariance", () => {
    /**
     * Permutes the whole mixed-signal event set, including contributions that
     * disagree on `agent`, and asserts every ordering converges (ADR-098
     * decision 4).
     */
    it("folds to the same state regardless of delivery order", () => {
      const events: AggregateEvent[] = [
        spanEvent({
          agent: "claude_code",
          acceptedAt: 1_000,
          startTimeUnixMs: 5_000,
        }),
        logEvent({
          agent: "claude_cowork",
          acceptedAt: 3_000,
          facts: { "terminal.type": "vscode", "user.id": "user-1" },
        }),
        metricEvent({ acceptedAt: 2_000, asOfUnixMs: 500 }),
        spanEvent({
          agent: "claude_code",
          acceptedAt: 4_000,
          spanId: "span-2",
          startTimeUnixMs: 100,
        }),
      ];

      const report = checkOrderInvariance<
        CodingAgentSessionIdentityState,
        AggregateEvent
      >({
        init: codingAgentSession.init,
        apply: (state, event) => codingAgentSession.apply(state, event),
        events,
      });

      expect(report.invariant).toBe(true);
    });
  });
});
