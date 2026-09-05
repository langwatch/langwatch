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

import {
  type LangyLiveWait,
  mergeLangyWaitStatus,
} from "../logic/langyLocalWaits";

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
  /**
   * Whether the durable record says the folder is connected, or null before
   * that record has been read. Its own field, because the record answers for
   * turns this browser never watched and the live entry above does not.
   */
  workspaceConnected: boolean | null;
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
  /**
   * The durable record's word on whether the folder is connected. Bumps the
   * revision only when the answer CHANGES, so the queries watching it refetch
   * on the connect rather than on every read of the record.
   */
  recordWorkspaceState: (a: {
    conversationId: string | null;
    connected: boolean;
  }) => void;
  /**
   * Mark a card settled locally, the moment the answer is accepted.
   *
   * Records the settle even for a card this stream never carried: a tab that
   * adopted a running turn renders its cards from the durable record alone,
   * and the answer it just gave has to win over a durable record that still
   * reads `pending` until the tail lands.
   */
  settleWait: (a: {
    waitId: string;
    kind?: LangyLiveWait["kind"];
    status: LangyLiveWait["status"];
    /** What the reader answered, so the settled card can say it at once. */
    decision?: string;
    /**
     * Where the answer was given. A card settled by the refusal its own click
     * got names the terminal that answered first, so the reader is told who
     * answered rather than only that the card is closed.
     */
    source?: string;
  }) => void;
  /** Open another conversation: everything here belonged to the last one. */
  reset: (conversationId: string | null) => void;
}

export const useLangyLocalControlStore = create<LangyLocalControlState>(
  (set, get) => ({
    conversationId: null,
    waits: {},
    workspace: null,
    workspaceConnected: null,
    workspaceRevision: 0,

    recordWait: ({ conversationId, wait }) => {
      const state = get();
      // An entry for a conversation nobody is reading is not worth keeping,
      // and folding it into the open one would show the wrong card.
      if (conversationId && state.conversationId !== conversationId) return;
      // The live stream is replayed from its start on every attach, so the
      // `pending` entry that raised a card arrives again after the card was
      // answered. A card only ever moves forward.
      const known = state.waits[wait.waitId];
      const status = mergeLangyWaitStatus({
        durable: known?.status,
        live: wait.status,
      });
      set({ waits: { ...state.waits, [wait.waitId]: { ...wait, status } } });
    },

    recordWorkspace: ({ conversationId, workspace }) => {
      const state = get();
      if (conversationId && state.conversationId !== conversationId) return;
      set({
        workspace,
        workspaceRevision: state.workspaceRevision + 1,
      });
    },

    recordWorkspaceState: ({ conversationId, connected }) => {
      const state = get();
      if (conversationId && state.conversationId !== conversationId) return;
      if (state.workspaceConnected === connected) return;
      // The first read is not a change, it is the starting point: the queries
      // watching the revision are fetching their own first answer anyway.
      const first = state.workspaceConnected === null;
      set({
        workspaceConnected: connected,
        workspaceRevision: first
          ? state.workspaceRevision
          : state.workspaceRevision + 1,
      });
    },

    settleWait: ({ waitId, kind = "permission", status, decision, source }) => {
      const state = get();
      const wait = state.waits[waitId] ?? { waitId, kind, status: "pending" };
      set({
        waits: {
          ...state.waits,
          [waitId]: {
            ...wait,
            status,
            ...(decision === undefined ? {} : { decision }),
            ...(source === undefined ? {} : { source }),
          },
        },
      });
    },

    reset: (conversationId) =>
      set({
        conversationId,
        waits: {},
        workspace: null,
        workspaceConnected: null,
        workspaceRevision: 0,
      }),
  }),
);
