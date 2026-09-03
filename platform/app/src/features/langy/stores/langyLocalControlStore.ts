/**
 * The live half of local control (ADR-129): the wait cards and the folder
 * state as the OPEN stream reports them, before the durable tail lands.
 *
 * Deliberately a separate store from `langyStore`, for the same two reasons
 * the context-target store is separate: the traffic is its own (a keepalive
 * and a card per command, none of which the composer or the conversation list
 * care about), and the lifetime is its own (everything here is scoped to one
 * conversation and dropped when another opens).
 *
 * Nothing here is the truth. The durable record is, and `langyLocalWaits`
 * merges the two with a rule that only ever moves a card forward.
 */
import { create } from "zustand";

import type { LangyLiveWait } from "../logic/langyLocalWaits";

/** The folder as the live stream last reported it. */
export interface LangyLiveWorkspace {
  state: "connected" | "disconnected";
  name: string;
  root: string;
  hostname: string;
  gitBranch?: string;
}

interface LangyLocalControlState {
  /** The conversation these entries belong to; nothing else may read them. */
  conversationId: string | null;
  /** Live wait entries by wait id. */
  waits: Record<string, LangyLiveWait>;
  /** The last folder change this stream reported, or null. */
  workspace: LangyLiveWorkspace | null;
  /** Bumped whenever the folder changed, so a query can refetch on it. */
  workspaceRevision: number;

  recordWait: (a: {
    conversationId: string | null;
    wait: LangyLiveWait;
  }) => void;
  recordWorkspace: (a: {
    conversationId: string | null;
    workspace: LangyLiveWorkspace;
  }) => void;
  /** Mark a card settled locally, the moment the answer is accepted. */
  settleWait: (a: { waitId: string; status: LangyLiveWait["status"] }) => void;
  /** Open another conversation: everything here belonged to the last one. */
  reset: (conversationId: string | null) => void;
}

export const useLangyLocalControlStore = create<LangyLocalControlState>(
  (set, get) => ({
    conversationId: null,
    waits: {},
    workspace: null,
    workspaceRevision: 0,

    recordWait: ({ conversationId, wait }) => {
      const state = get();
      // An entry for a conversation nobody is reading is not worth keeping,
      // and folding it into the open one would show the wrong card.
      if (conversationId && state.conversationId !== conversationId) return;
      set({ waits: { ...state.waits, [wait.waitId]: wait } });
    },

    recordWorkspace: ({ conversationId, workspace }) => {
      const state = get();
      if (conversationId && state.conversationId !== conversationId) return;
      set({
        workspace,
        workspaceRevision: state.workspaceRevision + 1,
      });
    },

    settleWait: ({ waitId, status }) => {
      const state = get();
      const wait = state.waits[waitId];
      if (!wait) return;
      set({ waits: { ...state.waits, [waitId]: { ...wait, status } } });
    },

    reset: (conversationId) =>
      set({
        conversationId,
        waits: {},
        workspace: null,
        workspaceRevision: 0,
      }),
  }),
);
