import { useCallback, useRef, useState } from "react";

import { codingAgentApi } from "./coding-agent-api.ts";
import { useCodingAgentToaster, useShowErrorToast } from "./coding-agent-feedback.ts";
import { useCodingAgentRouter } from "./coding-agent-router.ts";
import {
  type ConversationTurn,
  lastTurnOfSession,
  openReplayHere,
  openReplayInExplorer,
  sayNothingWasStored,
} from "./open-replay.ts";

/** The workspace the rows were read from, and where its traces can be seen. */
interface TerminalReplayInput {
  projectId: string;
  /** Null when the caller has no explorer page to send the reader to. */
  projectSlug: string | null;
}

/**
 * The whole of what a replay needs to know: which session it is. Turns are
 * read from the session id, so any surface listing sessions can open one
 * without shaping its rows like the sessions table's.
 */
export interface ReplayableSession {
  sessionId: string;
}

/**
 * Opens session terminal replay by looking up last turn (drawer caches it);
 * drawer renders globally, so closing returns to original page.
 */
export function useTerminalReplay({ projectId, projectSlug }: TerminalReplayInput) {
  const utils = codingAgentApi.useUtils();
  const router = useCodingAgentRouter();
  const toaster = useCodingAgentToaster();
  const showErrorToast = useShowErrorToast();
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
        else sayNothingWasStored(toaster);
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
    [projectId, showErrorToast, toaster, utils],
  );

  const openReplay = useCallback(
    (row: ReplayableSession) =>
      withLastTurn(row, (turn) => openReplayHere({ turn, projectId, router })),
    [projectId, router, withLastTurn],
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
      void utils.traces.conversationContext.prefetch({
        projectId,
        conversationId: row.sessionId,
      });
    },
    [projectId, utils],
  );

  return { openingSessionId, openReplay, openInExplorer, prefetch };
}
