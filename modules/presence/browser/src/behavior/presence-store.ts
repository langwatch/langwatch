import { defineSlice } from "@langwatch/browser-host/global-store";
import { PRESENCE_SESSIONS_SLICE, type PresenceState } from "@langwatch/presence-contract";

export {
  selectPeerSessions,
  selectPeersMatching,
  selectPeersOnConversation,
  selectPeersOnTrace,
} from "@langwatch/presence-contract";

/** Who is here, held in the global UI store (`presence:sessions`); presence owns the writes. */
export const usePresenceStore = defineSlice<PresenceState>({
  name: PRESENCE_SESSIONS_SLICE,
  create: (set) => ({
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
  }),
});
