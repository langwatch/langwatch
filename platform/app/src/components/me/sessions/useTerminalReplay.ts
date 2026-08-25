import { useCallback, useRef, useState } from "react";

import { showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

import {
  type ConversationTurn,
  lastTurnOfSession,
  openReplayHere,
  openReplayInExplorer,
  sayNothingWasStored,
} from "./openReplay";

/** The workspace the rows were read from, and where its traces can be seen. */
interface TerminalReplayInput {
  projectId: string;
  /** Null when the caller has no explorer page to send the reader to. */
  projectSlug: string | null;
}

/**
 * The whole of what a replay needs to know about a session: which session it
 * is. The turns are read from the session id, so any surface that lists
 * sessions can open one without first shaping its rows like the sessions
 * table's, and this hook works the same on all of them.
 */
export interface ReplayableSession {
  sessionId: string;
}

/**
 * Opening a session's terminal replay.
 *
 * A session is a conversation of many turns and the replay reads the last of
 * them, so the trace has to be looked up before anything can open. The lookup
 * is the same one the drawer itself caches, so hovering a row pays for it
 * ahead of the click and the click usually opens on the next frame.
 *
 * The drawer opens over the sessions page rather than navigating to the
 * explorer: the global mount renders it wherever the reader is, so closing it
 * puts them back on the table they narrowed rather than on a fresh one.
 */
export function useTerminalReplay({ projectId, projectSlug }: TerminalReplayInput) {
  const utils = api.useUtils();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  /** Sessions whose turn is being looked up right now. */
  const inFlightRef = useRef<Set<string>>(new Set());

  const withLastTurn = useCallback(
    async (row: ReplayableSession, open: (turn: ConversationTurn) => void) => {
      // A second click on a session already being looked up is the same
      // request, and answering it twice opens the replay twice. The guard is a
      // ref rather than state because both clicks land before React has
      // re-rendered either of them.
      if (inFlightRef.current.has(row.sessionId)) return;
      inFlightRef.current.add(row.sessionId);
      setOpeningSessionId(row.sessionId);
      try {
        const turn = await lastTurnOfSession({
          utils,
          projectId,
          sessionId: row.sessionId,
        });
        if (turn) open(turn);
        else sayNothingWasStored();
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't open the terminal replay",
        });
      } finally {
        inFlightRef.current.delete(row.sessionId);
        // Only this session's own spinner is cleared. A reader who chose a
        // second session while the first was still resolving is waiting on
        // that one, and clearing whatever happens to be current would take
        // its spinner away while it is still loading.
        setOpeningSessionId((current) => (current === row.sessionId ? null : current));
      }
    },
    [projectId, utils],
  );

  const openReplay = useCallback(
    (row: ReplayableSession) =>
      withLastTurn(row, (turn) => openReplayHere({ turn, projectId, openDrawer })),
    [openDrawer, projectId, withLastTurn],
  );

  const openInExplorer = useCallback(
    (row: ReplayableSession) =>
      withLastTurn(row, (turn) => {
        if (projectSlug) openReplayInExplorer({ turn, projectSlug, router });
      }),
    [projectSlug, router, withLastTurn],
  );

  const prefetch = useCallback(
    (row: ReplayableSession) => {
      void utils.tracesV2.conversationContext.prefetch({
        projectId,
        conversationId: row.sessionId,
      });
    },
    [projectId, utils],
  );

  return { openingSessionId, openReplay, openInExplorer, prefetch };
}
