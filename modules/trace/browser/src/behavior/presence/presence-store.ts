import { readSlice } from "@langwatch/browser-host/global-store";
import {
  PRESENCE_ABSENT,
  PRESENCE_SESSIONS_SLICE,
  type PresenceState,
} from "@langwatch/presence-contract";

export {
  selectPeerSessions,
  selectPeersMatching,
  selectPeersOnConversation,
  selectPeersOnTrace,
} from "@langwatch/presence-contract";

/** Who is here, read from the global UI store (`presence:sessions`); the feed applies events. */
export const usePresenceStore = readSlice<PresenceState>({
  name: PRESENCE_SESSIONS_SLICE,
  absent: PRESENCE_ABSENT,
});
