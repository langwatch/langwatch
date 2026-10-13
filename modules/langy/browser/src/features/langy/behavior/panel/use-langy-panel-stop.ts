import { toaster } from "@langwatch/design-system/toaster";
import { isSendUnanswered } from "@langwatch/langy-contract";
import { useCallback, useEffect } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { resolveLangyStopTarget } from "../../../../model/langy-stop-target.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

type StopTarget = { projectId: string; conversationId: string; turnId: string };

/** Nothing was sent and nothing is running: a stale click. */
function announceNothingToStop(): void {
  toaster.create({
    title: "Langy",
    description: "There's no answer in progress to stop.",
    type: "info",
    duration: 5000,
  });
}

/**
 * A user Stop is a REAL backend stop (ADR-078): the durable stopped terminal is the
 * confirmation. A stop asked before the server named the turn is KEPT and sent the moment an id
 * exists, from this tab's own send or from the durable record catching up.
 */
export function useLangyPanelStop({
  projectId,
  foldInFlightTurnId,
  stop,
}: {
  projectId: string | undefined;
  foldInFlightTurnId: string | null | undefined;
  /** Aborts this browser's own subscription. */
  stop: () => Promise<void>;
}) {
  const stopTurn = api.langy.stopTurn.useMutation();

  // This tab's own live turn if it has one, otherwise the turn the durable
  // record names — read from the store at call time to dodge a stale closure.
  const resolveStopTarget = useCallback(() => {
    const store = useLangyStore.getState();
    return resolveLangyStopTarget({
      projectId,
      conversationId: store.activeConversationId,
      localTurnId: store.activeTurnId,
      localSettledTurnId: store.settledTurnId,
      localSendPending: isSendUnanswered(store),
      durableTurnId: foldInFlightTurnId ?? null,
    });
  }, [projectId, foldInFlightTurnId]);

  // Only ONCE THE TURN IS NAMED does the local abort run: during the send it
  // would kill the very request about to answer with the ids this stop needs.
  const dispatchStop = useCallback(
    (target: StopTarget) => {
      void stop();
      useLangyDevLog.getState().recordOutbound("stop", `stop turn ${target.turnId}`, {
        conversationId: target.conversationId,
        turnId: target.turnId,
        resolution: "dispatch",
      });
      // A request that did not land hands the control back; a stop a beat too
      // late is settled to idle by the fold's next read.
      void stopTurn
        .mutateAsync({
          projectId: target.projectId,
          conversationId: target.conversationId,
          turnId: target.turnId,
        })
        .catch(() => useLangyStore.getState().abandonStop());
    },
    [stop, stopTurn],
  );

  const handleStop = useCallback(() => {
    const store = useLangyStore.getState();
    const target = resolveStopTarget();
    if (target.kind === "dispatch") {
      store.requestStop({ dispatched: true });
      dispatchStop(target);
      return;
    }
    // Tape the ask that could not go out yet: the inspector shows what this client TRIED.
    useLangyDevLog.getState().recordOutbound("stop", `stop turn ${store.activeTurnId ?? "?"}`, {
      conversationId: store.activeConversationId,
      turnId: store.activeTurnId,
      resolution: target.reason,
    });
    if (store.turnPhase === "idle") {
      announceNothingToStop();
      return;
    }
    store.requestStop({ dispatched: false });
  }, [resolveStopTarget, dispatchStop]);

  const stopPending = useLangyStore((s) => s.stopPending);
  const localTurnId = useLangyStore((s) => s.activeTurnId);
  useEffect(() => {
    if (!stopPending) return;
    const target = resolveStopTarget();
    if (target.kind !== "dispatch") return;
    useLangyStore.getState().stopDispatched();
    dispatchStop(target);
  }, [stopPending, localTurnId, resolveStopTarget, dispatchStop]);

  return handleStop;
}
