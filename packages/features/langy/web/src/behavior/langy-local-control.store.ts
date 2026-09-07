/**
 * The live half of local control (ADR-129): wait cards and folder state as the OPEN stream
 * reports them, before the durable tail lands and `langyLocalWaits` merges the two.
 */
import { create } from "zustand";

import { type LangyLiveWait, mergeLangyWaitStatus } from "../model/langy-local-waits.ts";

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

  recordWait: (a: { conversationId: string | null; wait: LangyLiveWait }) => void;
  recordWorkspace: (a: { conversationId: string | null; workspace: LangyLiveWorkspace }) => void;
  /**
   * The durable record's word on whether the folder is connected. Bumps the
   * revision only when the answer CHANGES, so the queries watching it refetch
   * on the connect rather than on every read of the record.
   */
  recordWorkspaceState: (a: { conversationId: string | null; connected: boolean }) => void;
  /**
   * Marks a card settled locally the moment its answer is accepted, even for a card this stream
   * never carried, so it wins over a durable record that still reads `pending`.
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

/** True when `conversationId` names a conversation other than the one live. */
function isStaleConversation(
  state: LangyLocalControlState,
  conversationId: string | null,
): boolean {
  // An entry for a conversation nobody is reading is not worth keeping,
  // and folding it into the open one would show the wrong card.
  return Boolean(conversationId) && state.conversationId !== conversationId;
}

function recordWaitEntry(
  state: LangyLocalControlState,
  { conversationId, wait }: { conversationId: string | null; wait: LangyLiveWait },
): Partial<LangyLocalControlState> | null {
  if (isStaleConversation(state, conversationId)) return null;
  // The live stream is replayed from its start on every attach, so the
  // `pending` entry that raised a card arrives again after the card was
  // answered. A card only ever moves forward.
  const known = state.waits[wait.waitId];
  const status = mergeLangyWaitStatus({ durable: known?.status, live: wait.status });
  return { waits: { ...state.waits, [wait.waitId]: { ...wait, status } } };
}

function recordWorkspaceEntry(
  state: LangyLocalControlState,
  { conversationId, workspace }: { conversationId: string | null; workspace: LangyLiveWorkspace },
): Partial<LangyLocalControlState> | null {
  if (isStaleConversation(state, conversationId)) return null;
  return { workspace, workspaceRevision: state.workspaceRevision + 1 };
}

function recordWorkspaceStateEntry(
  state: LangyLocalControlState,
  { conversationId, connected }: { conversationId: string | null; connected: boolean },
): Partial<LangyLocalControlState> | null {
  if (isStaleConversation(state, conversationId)) return null;
  if (state.workspaceConnected === connected) return null;
  // The first read is not a change, it is the starting point: the queries
  // watching the revision are fetching their own first answer anyway.
  const first = state.workspaceConnected === null;
  return {
    workspaceConnected: connected,
    workspaceRevision: first ? state.workspaceRevision : state.workspaceRevision + 1,
  };
}

function settleWaitEntry(
  state: LangyLocalControlState,
  {
    waitId,
    kind = "permission",
    status,
    decision,
    source,
  }: {
    waitId: string;
    kind?: LangyLiveWait["kind"];
    status: LangyLiveWait["status"];
    decision?: string;
    source?: string;
  },
): Partial<LangyLocalControlState> {
  const wait = state.waits[waitId] ?? { waitId, kind, status: "pending" };
  return {
    waits: {
      ...state.waits,
      [waitId]: {
        ...wait,
        status,
        ...(decision === undefined ? {} : { decision }),
        ...(source === undefined ? {} : { source }),
      },
    },
  };
}

export const useLangyLocalControlStore = create<LangyLocalControlState>((set, get) => ({
  conversationId: null,
  waits: {},
  workspace: null,
  workspaceConnected: null,
  workspaceRevision: 0,

  recordWait: (a) => {
    const patch = recordWaitEntry(get(), a);
    if (patch) set(patch);
  },

  recordWorkspace: (a) => {
    const patch = recordWorkspaceEntry(get(), a);
    if (patch) set(patch);
  },

  recordWorkspaceState: (a) => {
    const patch = recordWorkspaceStateEntry(get(), a);
    if (patch) set(patch);
  },

  settleWait: (a) => set(settleWaitEntry(get(), a)),

  reset: (conversationId) =>
    set({
      conversationId,
      waits: {},
      workspace: null,
      workspaceConnected: null,
      workspaceRevision: 0,
    }),
}));
