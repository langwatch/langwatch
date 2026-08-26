/**
 * What the presence store keeps for peers vs. the local session.
 * See packages/features/presence/specs/presence.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { PresenceSession } from "@langwatch/presence-contract";
import {
  selectPeersMatching,
  selectPeersOnConversation,
  selectPeersOnTrace,
  selectPeerSessions,
  usePresenceStore,
} from "../src/presence-store";

function session(overrides: Partial<PresenceSession> & { sessionId: string }): PresenceSession {
  return {
    projectId: "project-1",
    user: { id: overrides.sessionId, name: "Someone", image: null },
    location: { lens: "traces", route: {} },
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  usePresenceStore.getState().reset();
  usePresenceStore.setState({ selfSessionId: null });
});

describe("given the presence store", () => {
  describe("when a snapshot event arrives", () => {
    it("replaces every tracked session", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session({ sessionId: "a" }), session({ sessionId: "b" })],
      });

      expect(usePresenceStore.getState().sessions.size).toBe(2);

      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session({ sessionId: "c" })],
      });

      const ids = Array.from(usePresenceStore.getState().sessions.keys());
      expect(ids).toEqual(["c"]);
    });
  });

  describe("when a join or update event arrives", () => {
    it("upserts that session by id", () => {
      usePresenceStore.getState().applyEvent({
        kind: "join",
        session: session({ sessionId: "a", location: { lens: "traces", route: { traceId: "t1" } } }),
      });
      usePresenceStore.getState().applyEvent({
        kind: "update",
        session: session({ sessionId: "a", location: { lens: "traces", route: { traceId: "t2" } } }),
      });

      const state = usePresenceStore.getState();
      expect(state.sessions.size).toBe(1);
      expect(state.sessions.get("a")?.location.route.traceId).toBe("t2");
    });
  });

  describe("when a leave event arrives", () => {
    it("removes only that sessionId", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session({ sessionId: "a" }), session({ sessionId: "b" })],
      });
      usePresenceStore.getState().applyEvent({ kind: "leave", sessionId: "a" });

      const ids = Array.from(usePresenceStore.getState().sessions.keys());
      expect(ids).toEqual(["b"]);
    });
  });

  describe("when selecting peer sessions", () => {
    it("excludes the local session's own selfSessionId", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session({ sessionId: "self" }), session({ sessionId: "peer" })],
      });
      usePresenceStore.setState({ selfSessionId: "self" });

      const peers = selectPeerSessions(usePresenceStore.getState());
      expect(peers.map((s) => s.sessionId)).toEqual(["peer"]);
    });

    it("filters peers on a trace via selectPeersOnTrace", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [
          session({ sessionId: "a", location: { lens: "traces", route: { traceId: "t1" } } }),
          session({ sessionId: "b", location: { lens: "traces", route: { traceId: "t2" } } }),
        ],
      });

      const onT1 = selectPeersOnTrace(usePresenceStore.getState(), "t1");
      expect(onT1.map((s) => s.sessionId)).toEqual(["a"]);
    });

    it("filters peers on a conversation via selectPeersOnConversation", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [
          session({
            sessionId: "a",
            location: { lens: "traces", route: { conversationId: "c1" } },
          }),
          session({
            sessionId: "b",
            location: { lens: "traces", route: { conversationId: "c2" } },
          }),
        ],
      });

      const onC1 = selectPeersOnConversation(usePresenceStore.getState(), "c1");
      expect(onC1.map((s) => s.sessionId)).toEqual(["a"]);
    });

    it("supports an arbitrary predicate via selectPeersMatching", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [
          session({
            sessionId: "a",
            location: { lens: "traces", route: {}, view: { tab: "summary" } },
          }),
          session({
            sessionId: "b",
            location: { lens: "traces", route: {}, view: { tab: "llm" } },
          }),
        ],
      });

      const onSummary = selectPeersMatching(
        usePresenceStore.getState(),
        (s) => s.location.view?.tab === "summary",
      );
      expect(onSummary.map((s) => s.sessionId)).toEqual(["a"]);
    });
  });
});
