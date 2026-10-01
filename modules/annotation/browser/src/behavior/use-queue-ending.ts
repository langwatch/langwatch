/**
 * The end of the queue as a state rather than a race: the celebration shows
 * after the dataset add succeeds, or after the reviewer confirms ending without
 * one, and the last item is recorded done at that same moment.
 */

import { useAnnotationQueueSessionStore } from "@langwatch/trace-browser-kit";
import { useCallback, useEffect, useRef, useState } from "react";

/** `walking` until the last item; then the dataset offer, the question, and done. */
export type QueueEnding = "walking" | "handoff" | "asking" | "done";

export function useQueueEnding({
  handoffWanted,
  traceIds,
  isHandoffDrawerOpen,
  openHandoffDrawer,
  recordItemDone,
}: {
  /** Whether the bar's dataset toggle is on. */
  handoffWanted: boolean;
  /** The traces this sitting counted. */
  traceIds: string[];
  isHandoffDrawerOpen: boolean;
  openHandoffDrawer: (traceIds: string[]) => void;
  /** Marks the item the reviewer is finishing as done. */
  recordItemDone: () => void;
}) {
  const [ending, setEnding] = useState<QueueEnding>("walking");
  const noteHandoffOpened = useAnnotationQueueSessionStore((state) => state.noteHandoffOpened);
  const resetHandoff = useAnnotationQueueSessionStore((state) => state.resetHandoff);
  // Dismissed only once seen open: the frame before the URL names it is not a dismissal.
  const drawerWasSeenOpen = useRef(false);

  const celebrate = useCallback(() => {
    recordItemDone();
    setEnding("done");
  }, [recordItemDone]);

  const finishLastItem = useCallback(() => {
    if (!handoffWanted || traceIds.length === 0) {
      celebrate();
      return;
    }
    drawerWasSeenOpen.current = false;
    noteHandoffOpened();
    openHandoffDrawer(traceIds);
    setEnding("handoff");
  }, [handoffWanted, traceIds, noteHandoffOpened, openHandoffDrawer, celebrate]);

  useHandoffOutcome({
    isOffered: ending === "handoff",
    isHandoffDrawerOpen,
    drawerWasSeenOpen,
    onAdded: celebrate,
    onDismissed: useCallback(() => setEnding("asking"), []),
  });

  return {
    ending,
    finishLastItem,
    confirmEndWithoutDataset: useCallback(() => {
      resetHandoff();
      celebrate();
    }, [resetHandoff, celebrate]),
    keepSession: useCallback(() => {
      resetHandoff();
      setEnding("walking");
    }, [resetHandoff]),
  };
}

/** What became of the offer: the records landed, or the reviewer closed the drawer. */
function useHandoffOutcome({
  isOffered,
  isHandoffDrawerOpen,
  drawerWasSeenOpen,
  onAdded,
  onDismissed,
}: {
  isOffered: boolean;
  isHandoffDrawerOpen: boolean;
  drawerWasSeenOpen: { current: boolean };
  onAdded: () => void;
  onDismissed: () => void;
}) {
  const handoff = useAnnotationQueueSessionStore((state) => state.handoff);
  const setSessionActive = useAnnotationQueueSessionStore((state) => state.setActive);

  useEffect(() => {
    if (!isOffered) return;
    if (handoff === "added") {
      // The sitting's set is spent once it has become dataset records.
      setSessionActive(false);
      onAdded();
      return;
    }
    if (isHandoffDrawerOpen) {
      drawerWasSeenOpen.current = true;
      return;
    }
    if (drawerWasSeenOpen.current) onDismissed();
  }, [
    isOffered,
    handoff,
    isHandoffDrawerOpen,
    drawerWasSeenOpen,
    setSessionActive,
    onAdded,
    onDismissed,
  ]);
}
