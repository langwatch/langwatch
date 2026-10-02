import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import {
  explainLangyError,
  type LangyErrorPresentation,
  readLangyStreamError,
  resolveLiveTurnError,
} from "../logic/langy-error-explainer.ts";
import { turnHadSideEffects, useLangyTurnRecovery } from "../use-langy-turn-recovery.ts";

type ErrorActionKind = "connect-github" | "configure-model" | "reconnect-codex" | "retry";

/**
 * The turn's failure: the LIVE one, else the DURABLE one off the conversation fold (so a refresh
 * after a failed turn still explains it). The durable one is suppressed while a turn is in flight:
 * the previous turn's error is not this one's.
 */
function presentTurnError({
  error,
  isBusy,
  durableLastError,
}: {
  error: Error | undefined;
  isBusy: boolean;
  durableLastError: string | null;
}): LangyErrorPresentation | null {
  if (error) {
    const domain = resolveLiveTurnError({ error, durableLastError });
    // Debug context for the case nothing could name; `meta` is the card's contract, not a log.
    if (domain.code === "unknown") console.warn("[Langy] unclassified turn failure", error.message);
    return explainLangyError(domain);
  }
  if (isBusy || !durableLastError) return null;
  const domain = readLangyStreamError(durableLastError);
  return domain ? explainLangyError(domain) : null;
}

/**
 * A failed turn, handled rather than only reported: the recovery policy re-drives the kinds that
 * heal themselves; a failure gives the draft back; "Sign in to Codex" swaps the column to setup.
 */
export function useLangyTurnFailure({
  error,
  isBusy,
  turnActive,
  durableLastError,
  messages,
  retryEngineTurn,
  restoreDraftOnFailure,
}: {
  error: Error | undefined;
  isBusy: boolean;
  turnActive: boolean;
  durableLastError: string | null;
  messages: UIMessage[];
  /** The engine's retry, which keeps the failed reply on screen while it re-drives the turn. */
  retryEngineTurn: () => void;
  restoreDraftOnFailure: () => void;
}) {
  const utils = api.useUtils();
  const turnError = useMemo(
    () => presentTurnError({ error, isBusy, durableLastError }),
    [error, isBusy, durableLastError],
  );

  // RE-DRIVE the turn; never RE-POST the message.
  const messageCount = messages.length;
  const retryTurn = useCallback(() => {
    if (messageCount > 0) retryEngineTurn();
  }, [retryEngineTurn, messageCount]);

  const [reconnectCodex, setReconnectCodex] = useState(false);
  const onErrorAction = useCallback(
    (kind: ErrorActionKind) => {
      if (kind === "reconnect-codex") setReconnectCodex(true);
      else if (kind === "retry") retryTurn();
    },
    [retryTurn],
  );

  const recovery = useLangyTurnRecovery({
    errorKind: turnError?.kind ?? null,
    // useChat mints a fresh Error per failure, so its reference IS the failure's identity.
    errorId: error,
    sideEffectsObserved: turnHadSideEffects(messages),
    onRetry: retryTurn,
  });

  // A missing GitHub connection is an unmet prerequisite, not a failure: the connect card
  // goes inline.
  const needsGithubConnect =
    turnError?.render === "suppress" && turnError.action?.kind === "connect-github";

  useEffect(() => {
    if (!turnError) return;
    restoreDraftOnFailure();
    if (turnError.kind === "langy_turn_in_progress") void utils.langy.messages.invalidate();
  }, [turnError, restoreDraftOnFailure, utils]);

  // INVARIANT: between send and a terminal state the column always shows SOMETHING — a working
  // line, a recovering line, a card, or the answer — never blank.
  const interrupted = !!turnError || recovery.isRecovering || needsGithubConnect;
  return {
    liveTurnInFlight: (isBusy || turnActive) && !interrupted,
    isSettling: !!turnError || recovery.isRecovering,
    turnError,
    retryTurn,
    onErrorAction,
    recovery,
    needsGithubConnect,
    reconnectCodex,
    setReconnectCodex,
  };
}

/**
 * The GitHub connect card finished: the turn stalled on the missing integration, so it is
 * re-driven once — a double-click on the card must not fire two turns.
 */
export function useLangyGithubRedrive({
  isBusy,
  organizationId,
  retryTurn,
}: {
  isBusy: boolean;
  organizationId: string | undefined;
  retryTurn: () => void;
}) {
  const utils = api.useUtils();
  const redrivenRef = useRef(false);
  useEffect(() => {
    if (isBusy) redrivenRef.current = false;
  }, [isBusy]);
  return useCallback(() => {
    void utils.github.getConnectionStatus.invalidate({ organizationId: organizationId ?? "" });
    if (redrivenRef.current) return;
    redrivenRef.current = true;
    retryTurn();
  }, [utils, organizationId, retryTurn]);
}
