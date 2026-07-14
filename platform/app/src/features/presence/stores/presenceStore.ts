import { create } from "zustand";
import type {
  PresenceEvent,
  PresenceSession,
} from "~/server/app-layer/presence/types";

interface PresenceState {
  /** The current user's own sessionId, so callers can filter themselves out. */
  selfSessionId: string | null;
  sessions: Map<string, PresenceSession>;

  setSelfSessionId: (sessionId: string | null) => void;
  applyEvent: (event: PresenceEvent) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  selfSessionId: null,
  sessions: new Map(),

  setSelfSessionId: (sessionId) => set({ selfSessionId: sessionId }),

  applyEvent: (event) =>
    set((state) => {
      const next = new Map(state.sessions);
      switch (event.kind) {
        case "snapshot":
          next.clear();
          for (const session of event.sessions) {
            next.set(session.sessionId, session);
          }
          return { sessions: next };
        case "join":
        case "update":
          next.set(event.session.sessionId, event.session);
          return { sessions: next };
        case "leave":
          next.delete(event.sessionId);
          return { sessions: next };
        default:
          return state;
      }
    }),

  reset: () => set({ sessions: new Map() }),
}));

/** All sessions except the current user's own. */
export function selectPeerSessions(state: PresenceState): PresenceSession[] {
  const peers: PresenceSession[] = [];
  for (const session of state.sessions.values()) {
    if (session.sessionId === state.selfSessionId) continue;
    peers.push(session);
  }
  return peers;
}

/** Peer sessions whose location points at the given trace. */
export function selectPeersOnTrace(
  state: PresenceState,
  traceId: string,
): PresenceSession[] {
  return selectPeerSessions(state).filter(
    (s) => s.location.route.traceId === traceId,
  );
}

/** Peer sessions whose location points at the given conversation. */
export function selectPeersOnConversation(
  state: PresenceState,
  conversationId: string,
): PresenceSession[] {
  return selectPeerSessions(state).filter(
    (s) => s.location.route.conversationId === conversationId,
  );
}

/** Generic peer filter for arbitrary location predicates. */
export function selectPeersMatching(
  state: PresenceState,
  predicate: (session: PresenceSession) => boolean,
): PresenceSession[] {
  return selectPeerSessions(state).filter(predicate);
}
