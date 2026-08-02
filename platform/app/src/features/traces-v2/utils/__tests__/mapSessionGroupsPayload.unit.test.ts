import { describe, expect, it } from "vitest";
import {
  mapSessionGroupsPayload,
  mapSessionGroupToConversationGroup,
  type SessionGroupPayloadItem,
} from "../mapSessionGroupsPayload";

function payloadItem(
  overrides: Partial<SessionGroupPayloadItem> = {},
): SessionGroupPayloadItem {
  return {
    conversationId: "sess-1",
    traceCount: 42,
    totalCost: 3.5,
    totalTokens: 120_000,
    cacheReadTokens: 900_000,
    cacheCreationTokens: 5000,
    contextSizeTokens: 88_000,
    totalDurationMs: 640_000,
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_003_600_000,
    models: ["claude-sonnet-4"],
    primaryModel: "claude-sonnet-4",
    serviceName: "coding-agent-cli",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 400,
    input: "make the tests pass",
    output: "all green",
    codingAgent: null,
    ...overrides,
  };
}

describe("given a session group payload from the sessions procedure", () => {
  describe("when mapping it onto the conversation group view model", () => {
    /** @scenario Session rows map to the conversation group view model */
    it("lands totals, trace count, context size and last activity on the row", () => {
      const group = mapSessionGroupToConversationGroup(payloadItem());

      expect(group).toMatchObject({
        conversationId: "sess-1",
        traceCount: 42,
        totalCost: 3.5,
        totalTokens: 120_000,
        totalDuration: 640_000,
        totalSpans: 400,
        contextSizeTokens: 88_000,
        latestTimestamp: 1_700_003_600_000,
        earliestTimestamp: 1_700_000_000_000,
        primaryModel: "claude-sonnet-4",
        serviceName: "coding-agent-cli",
        lastMessage: "make the tests pass",
        lastOutput: "all green",
        worstStatus: "ok",
      });
      // Turn rows load lazily on expand; the totals never depend on them.
      expect(group.traces).toEqual([]);
    });

    it("fills model calls and compactions from the coding-agent enrichment", () => {
      const group = mapSessionGroupToConversationGroup(
        payloadItem({
          contextSizeTokens: 50_000,
          codingAgent: {
            modelCalls: 63,
            compactions: 4,
            peakContextTokens: 173_000,
            subAgents: 2,
          },
        }),
      );

      expect(group.modelCalls).toBe(63);
      expect(group.compactions).toBe(4);
      // The fold's peak context wins over the per-trace attribute maximum.
      expect(group.contextSizeTokens).toBe(173_000);
    });

    it("keeps a zero peak context instead of falling back to the trace maximum", () => {
      const group = mapSessionGroupToConversationGroup(
        payloadItem({
          contextSizeTokens: 50_000,
          codingAgent: {
            modelCalls: 1,
            compactions: 0,
            peakContextTokens: 0,
            subAgents: 0,
          },
        }),
      );

      expect(group.contextSizeTokens).toBe(0);
    });

    it("keeps enrichment fields null for ordinary conversations", () => {
      const group = mapSessionGroupToConversationGroup(payloadItem());
      expect(group.modelCalls).toBeNull();
      expect(group.compactions).toBeNull();
    });

    it("derives the worst status from error and warning counts", () => {
      expect(
        mapSessionGroupToConversationGroup(payloadItem({ errorCount: 2 }))
          .worstStatus,
      ).toBe("error");
      expect(
        mapSessionGroupToConversationGroup(payloadItem({ warningCount: 1 }))
          .worstStatus,
      ).toBe("warning");
    });
  });
});

describe("given no sessions payload yet", () => {
  describe("when mapping the payload", () => {
    it("returns an empty list", () => {
      expect(mapSessionGroupsPayload(undefined)).toEqual([]);
    });
  });
});

describe("given a payload carrying several sessions", () => {
  describe("when mapping the payload", () => {
    it("maps each one", () => {
      const groups = mapSessionGroupsPayload({
        sessions: [payloadItem(), payloadItem({ conversationId: "sess-2" })],
      });
      expect(groups.map((group) => group.conversationId)).toEqual([
        "sess-1",
        "sess-2",
      ]);
    });
  });
});
