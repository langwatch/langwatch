/**
 * Presence's client state in the global UI store, under `presence:`. Presence
 * writes it (its feed applies events through the slice's actions); any module reads it.
 */

import type { PresenceEvent, PresenceSession } from "./presence.ts";

export const PRESENCE_SESSIONS_SLICE = "presence:sessions";
export const PRESENCE_SECTION_TRACKER_SLICE = "presence:section-tracker";
export const PRESENCE_PREFERENCES_SLICE = "presence:preferences";

export interface PresenceState {
  /** The current user's own sessionId, so callers can filter themselves out. */
  selfSessionId: string | null;
  sessions: Map<string, PresenceSession>;

  setSelfSessionId: (sessionId: string | null) => void;
  applyEvent: (event: PresenceEvent) => void;
  reset: () => void;
}

export interface SectionTrackerState {
  /**
   * Visibility ratio (0–1) for each registered section id. We pick the
   * section with the highest ratio as the "currently focused" section so
   * peers see one stable hint per user, not a list of partial overlaps.
   */
  visibility: Map<string, number>;

  setVisibility: (id: string, ratio: number) => void;
  unregister: (id: string) => void;
  reset: () => void;
}

export interface PresencePreferencesState {
  /**
   * When true, the local user opts out of broadcasting their presence and
   * cursor to peers. They can still *see* peer presence; this only gates
   * the write side ("ghost mode").
   */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  toggleHidden: () => void;
}

const nothing = (): void => {};

/** What a reader sees where presence is not installed: nobody is here. */
export const PRESENCE_ABSENT: PresenceState = {
  selfSessionId: null,
  sessions: new Map(),
  setSelfSessionId: nothing,
  applyEvent: nothing,
  reset: nothing,
};

export const SECTION_TRACKER_ABSENT: SectionTrackerState = {
  visibility: new Map(),
  setVisibility: nothing,
  unregister: nothing,
  reset: nothing,
};

export const PRESENCE_PREFERENCES_ABSENT: PresencePreferencesState = {
  hidden: false,
  setHidden: nothing,
  toggleHidden: nothing,
};

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
export function selectPeersOnTrace(state: PresenceState, traceId: string): PresenceSession[] {
  return selectPeerSessions(state).filter((s) => s.location.route.traceId === traceId);
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

/** The section id with the highest current visibility, or undefined when nothing
 *  is in view. Undefined if nothing exceeds the noise floor (10%). */
export function pickMostVisibleSection(state: SectionTrackerState): string | undefined {
  let bestId: string | undefined;
  let bestRatio = 0.1;
  for (const [id, ratio] of state.visibility) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestId = id;
    }
  }
  return bestId;
}
