/**
 * The expanded session summary reports the session's TRUE trace count (the
 * server rollup) while the turn list under it is a capped preview, so the
 * label has to say which of the two the rows below it are
 * (specs/traces-v2/sessions-lens.feature).
 */
import { describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../../../types/trace";
import type { ConversationGroup } from "../../../../conversationGroups";
import { traceCountLabel } from "../ConversationSummary";

function group(overrides: Partial<ConversationGroup> = {}): ConversationGroup {
  return {
    conversationId: "sess-1",
    traces: [],
    traceCount: 1,
    totalDuration: 0,
    totalCost: 0,
    totalTokens: 0,
    totalSpans: 0,
    errorCount: 0,
    totalEvents: 0,
    totalEvals: 0,
    evalsPassedCount: 0,
    evalsFailedCount: 0,
    worstStatus: "ok",
    latestTimestamp: 0,
    earliestTimestamp: 0,
    lastMessage: "",
    lastOutput: "",
    primaryModel: "",
    serviceName: "",
    contextSizeTokens: null,
    modelCalls: null,
    compactions: null,
    ...overrides,
  };
}

const turns = (count: number): TraceListItem[] =>
  Array.from(
    { length: count },
    (_, index) => ({ traceId: `t-${index}` }) as TraceListItem,
  );

describe("given an expanded session holding more traces than the turn preview loads", () => {
  describe("when the expanded summary renders", () => {
    /** @scenario An expanded session says how much of it the turn list shows */
    it("reports how many of the session's traces are listed", () => {
      expect(traceCountLabel(group({ traceCount: 250, traces: turns(100) }))).toBe(
        "100 of 250 traces",
      );
    });

    it("reports the plain total once every turn is loaded", () => {
      expect(traceCountLabel(group({ traceCount: 3, traces: turns(3) }))).toBe(
        "3 traces",
      );
    });

    it("reports the plain total before any turn has loaded", () => {
      expect(traceCountLabel(group({ traceCount: 250, traces: [] }))).toBe("250 traces");
    });

    it("keeps the singular for a one-trace session", () => {
      expect(traceCountLabel(group({ traceCount: 1, traces: turns(1) }))).toBe("1 trace");
    });
  });
});
