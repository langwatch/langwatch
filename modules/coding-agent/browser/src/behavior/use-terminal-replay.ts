import { useCallback, useRef, useState } from "react";

import {
  type ConversationTurn,
  conversationContextInput,
  lastTurnOfSession,
  openReplayHere,
  openReplayInExplorer,
  sayNothingWasStored,
} from "../model/open-replay.ts";
import {
  memberTenantOf,
  type SessionIdentity,
  sessionIdentityKey,
} from "../model/session-identity.ts";
import { codingAgentApi } from "./coding-agent-api.ts";
import { useCodingAgentToaster, useShowErrorToast } from "./coding-agent-feedback.ts";
import { useCodingAgentRouter } from "./coding-agent-router.ts";

/** The workspace the rows were read from, and where its traces can be seen. */
interface TerminalReplayInput {
  projectId: string;
  /** Null when the caller has no explorer page to send the reader to. */
  projectSlug: string | null;
}

/**
 * The whole of what a replay needs to know: which session it is, and the
 * project that recorded it. Any surface listing sessions can open one without
 * shaping its rows like the sessions table's.
 */
export type ReplayableSession = SessionIdentity;

/**
 * Opens session terminal replay by looking up last turn (drawer caches it);
 * drawer renders globally, so closing returns to original page.
 */
export function useTerminalReplay({ projectId, projectSlug }: TerminalReplayInput) {
  const utils = codingAgentApi.useUtils();
  const router = useCodingAgentRouter();
  const toaster = useCodingAgentToaster();
  const showErrorToast = useShowErrorToast();
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  /** Sessions whose turn is being looked up right now, by identity key. */
  const inFlightRef = useRef<Set<string>>(new Set());

  const withLastTurn = useCallback(
    async (
      row: ReplayableSession,
      open: (turn: ConversationTurn, tenantId: string | undefined) => void,
    ) => {
      // A second click on a session already being looked up is the same
      // request, and answering it twice opens the replay twice. The guard is a
      // ref rather than state because both clicks land before React has
      // re-rendered either of them.
      const key = sessionIdentityKey(row);
      if (inFlightRef.current.has(key)) return;
      inFlightRef.current.add(key);
      setOpeningKey(key);
      const tenantId = memberTenantOf({ tenantId: row.tenantId, projectId });
      try {
        const turn = await lastTurnOfSession({
          utils,
          projectId,
          sessionId: row.sessionId,
          tenantId,
        });
        if (turn) open(turn, tenantId);
        else sayNothingWasStored(toaster);
      } catch (error) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't open the terminal replay",
        });
      } finally {
        inFlightRef.current.delete(key);
        // Only this session's own spinner is cleared. A reader who chose a
        // second session while the first was still resolving is waiting on
        // that one, and clearing whatever happens to be current would take
        // its spinner away while it is still loading.
        setOpeningKey((current) => (current === key ? null : current));
      }
    },
    [projectId, showErrorToast, toaster, utils],
  );

  const openReplay = useCallback(
    (row: ReplayableSession) =>
      withLastTurn(row, (turn, tenantId) => openReplayHere({ turn, projectId, tenantId, router })),
    [projectId, router, withLastTurn],
  );

  const openInExplorer = useCallback(
    (row: ReplayableSession) =>
      withLastTurn(row, (turn, tenantId) => {
        if (projectSlug) openReplayInExplorer({ turn, projectSlug, tenantId, router });
      }),
    [projectSlug, router, withLastTurn],
  );

  const prefetch = useCallback(
    (row: ReplayableSession) => {
      void utils.traces.conversationContext.prefetch(
        conversationContextInput({
          projectId,
          sessionId: row.sessionId,
          tenantId: memberTenantOf({ tenantId: row.tenantId, projectId }),
        }),
      );
    },
    [projectId, utils],
  );

  const isOpening = useCallback(
    (row: ReplayableSession) => openingKey === sessionIdentityKey(row),
    [openingKey],
  );

  return { isOpening, openReplay, openInExplorer, prefetch };
}
