import type { LangyEventCursor } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { type RefObject, useEffect, useRef } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { shouldRehydrateEngineFromDurable } from "../../../../model/foreign-turn-rehydration.ts";
import { isLangyTranscriptMessage } from "../../../../model/langy-transcript.ts";
import {
  shouldRefetchHistoryForAdoptedTurn,
  shouldResumeAdoptedTurn,
} from "../../model/logic/adopted-turn-resume.ts";
import type { LangyMessagesResult } from "../data/use-langy-messages.ts";
import { catchUpToSnapshot } from "../logic/langy-durable-catch-up.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

type HistoryMessages = LangyMessagesResult["messages"];

/**
 * Seed the LOCAL turn projection from the snapshot (ADR-059): its cursor is where the
 * durable-tail fold starts, and an in-flight turn id is what a refreshed tab adopts.
 */
export function useLangyTurnProjectionSeed({
  projectId,
  activeConversationId,
  eventCursor,
  currentTurnId,
}: {
  projectId: string | undefined;
  activeConversationId: string | null;
  eventCursor: LangyEventCursor | null;
  currentTurnId: string | null;
}) {
  const utils = api.useUtils();
  useEffect(() => {
    if (!activeConversationId) return;
    const store = useLangyStore.getState();
    if (store.turnProjection.cursor === null) {
      store.seedTurnProjection({ cursor: eventCursor, currentTurnId });
    } else if (projectId && eventCursor) {
      // A failed catch-up is retried by the next poll or signal; the fold never moved.
      catchUpToSnapshot({
        utils,
        projectId,
        conversationId: activeConversationId,
        snapshot: { cursor: eventCursor, currentTurnId },
      }).catch(() => undefined);
    }
    useLangyDevLog.getState().recordSnapshot({
      conversationId: activeConversationId,
      cursor: eventCursor,
      currentTurnId,
    });
  }, [activeConversationId, projectId, utils, eventCursor, currentTurnId]);
}

/**
 * Push a settled server history into the chat engine, gated on a USER selection so a background
 * refetch never clobbers the live stream; empty the engine when the conversation clears.
 */
export function useLangyEngineHistorySync({
  activeConversationId,
  historyMessages,
  isFetchingHistory,
  applyHistoryToEngine,
}: {
  activeConversationId: string | null;
  historyMessages: HistoryMessages;
  isFetchingHistory: boolean;
  applyHistoryToEngine: (messages: HistoryMessages) => void;
}) {
  const historyLoadConversationId = useLangyStore((s) => s.historyLoadConversationId);
  const consumeHistoryLoad = useLangyStore((s) => s.consumeHistoryLoad);
  useEffect(() => {
    if (!historyLoadConversationId || historyLoadConversationId !== activeConversationId) return;
    if (isFetchingHistory) return;
    applyHistoryToEngine(historyMessages);
    consumeHistoryLoad();
  }, [
    historyLoadConversationId,
    activeConversationId,
    isFetchingHistory,
    historyMessages,
    applyHistoryToEngine,
    consumeHistoryLoad,
  ]);

  // Fires only on the transition to null, so a first send is never wiped.
  useEffect(() => {
    if (activeConversationId === null) applyHistoryToEngine([]);
  }, [activeConversationId, applyHistoryToEngine]);
}

/** Foreign-turn re-hydration: a turn another tab ran lands in this engine from the record. */
export function useLangyForeignTurnRehydration({
  activeConversationId,
  historyMessages,
  isFetchingHistory,
  isBusy,
  engineMessageCount,
  applyHistoryToEngine,
}: {
  activeConversationId: string | null;
  historyMessages: HistoryMessages;
  isFetchingHistory: boolean;
  isBusy: boolean;
  engineMessageCount: number;
  applyHistoryToEngine: (messages: HistoryMessages) => void;
}) {
  const historyLoadConversationId = useLangyStore((s) => s.historyLoadConversationId);
  useEffect(() => {
    const rehydrate = shouldRehydrateEngineFromDurable({
      isHistoryLoadPending: historyLoadConversationId !== null,
      isStreaming: isBusy,
      isFetchingHistory,
      hasActiveConversation: activeConversationId !== null,
      durableMessageCount: historyMessages.filter(isLangyTranscriptMessage).length,
      engineMessageCount,
    });
    if (rehydrate) applyHistoryToEngine(historyMessages);
  }, [
    historyLoadConversationId,
    isBusy,
    isFetchingHistory,
    activeConversationId,
    historyMessages,
    engineMessageCount,
    applyHistoryToEngine,
  ]);
}

/**
 * The fold adopted a turn this tab did not dispatch: one transcript read lands its user message,
 * then the stream reattaches — its live-only instructions reach a tab only through the stream.
 */
export function useLangyAdoptedTurnResume({
  dispatchedTurnIdRef,
  resumedTurnIdRef,
  foldInFlightTurnId,
  historyMessageCount,
  isFetchingHistory,
  refetchHistory,
  isBusy,
  engineMessages,
  resumeStream,
}: {
  dispatchedTurnIdRef: RefObject<string | null>;
  resumedTurnIdRef: RefObject<string | null>;
  foldInFlightTurnId: string | null;
  historyMessageCount: number;
  isFetchingHistory: boolean;
  refetchHistory: () => void;
  isBusy: boolean;
  engineMessages: UIMessage[];
  resumeStream: () => Promise<void>;
}) {
  const turnActive = useLangyStore((s) => s.turnPhase !== "idle");
  const localTurnId = useLangyStore((s) => s.activeTurnId);
  const historyLoadConversationId = useLangyStore((s) => s.historyLoadConversationId);
  const refetchedForTurnRef = useRef<string | null>(null);
  useEffect(() => {
    const refetch = shouldRefetchHistoryForAdoptedTurn({
      turnActive,
      activeTurnId: localTurnId,
      dispatchedTurnId: dispatchedTurnIdRef.current,
      foldInFlightTurnId,
      refetchedTurnId: refetchedForTurnRef.current,
      hasHistory: historyMessageCount > 0,
      isFetchingHistory,
    });
    if (!refetch) return;
    refetchedForTurnRef.current = localTurnId;
    refetchHistory();
  }, [
    turnActive,
    localTurnId,
    foldInFlightTurnId,
    historyMessageCount,
    isFetchingHistory,
    refetchHistory,
    dispatchedTurnIdRef,
  ]);

  const lastEngineRole = engineMessages.at(-1)?.role ?? null;
  useEffect(() => {
    const resume = shouldResumeAdoptedTurn({
      turnActive,
      activeTurnId: localTurnId,
      dispatchedTurnId: dispatchedTurnIdRef.current,
      resumedTurnId: resumedTurnIdRef.current,
      isStreaming: isBusy,
      isHistoryLoadPending: historyLoadConversationId !== null,
      lastEngineRole,
    });
    if (!resume) return;
    resumedTurnIdRef.current = localTurnId;
    void resumeStream();
  }, [
    turnActive,
    localTurnId,
    isBusy,
    historyLoadConversationId,
    lastEngineRole,
    resumeStream,
    dispatchedTurnIdRef,
    resumedTurnIdRef,
  ]);
}
