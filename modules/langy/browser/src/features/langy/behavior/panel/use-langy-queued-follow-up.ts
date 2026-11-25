/**
 * Sends a conversation's queued messages as one follow-up turn once Langy is idle. A turn that
 * fails, or one the person stops, holds the queue for Send now instead.
 * Spec: modules/langy/specs/langy-queue-while-busy.feature
 */
import { useEffect, useRef } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  isQueueHeld,
  useLangyMessageQueue,
} from "../../../composer/behavior/langy-message-queue.store.ts";
import { langyFollowUpOf } from "../../../composer/model/langy-follow-up.ts";
import type { LangyPanelSend } from "./use-langy-panel-send.ts";

/** A conversation that had no id got one: what was queued in it goes with it. */
function useQueueFollowsAdoptedConversation(conversationId: string | null) {
  const previous = useRef(conversationId);
  useEffect(() => {
    if (previous.current === null && conversationId) {
      useLangyMessageQueue.getState().adopt(conversationId);
    }
    previous.current = conversationId;
  }, [conversationId]);
}

/** A turn that ends in an error holds what was queued behind it; the person decides. */
function useQueueHeldOnFailure({
  conversationId,
  failed,
}: {
  conversationId: string | null;
  failed: boolean;
}) {
  const wasFailed = useRef(failed);
  useEffect(() => {
    const queue = useLangyMessageQueue.getState();
    const hasQueued = queue.messages.some((queued) => queued.conversationId === conversationId);
    if (failed && !wasFailed.current && hasQueued) queue.hold(conversationId);
    wasFailed.current = failed;
  }, [failed, conversationId]);
}

export function useLangyQueuedFollowUp({
  isBusy,
  failed,
  recovering,
  send,
}: {
  isBusy: boolean;
  /** The last turn ended in an error the person sees. */
  failed: boolean;
  /** An automatic retry is pending or running; it owns the next turn. */
  recovering: boolean;
  send: LangyPanelSend;
}) {
  const conversationId = useLangyStore((s) => s.activeConversationId);
  const turnPhase = useLangyStore((s) => s.turnPhase);
  const waiting = useLangyMessageQueue((s) =>
    s.messages.some((queued) => queued.conversationId === conversationId),
  );
  const held = useLangyMessageQueue((s) => isQueueHeld({ held: s.held, conversationId }));
  useQueueFollowsAdoptedConversation(conversationId);
  useQueueHeldOnFailure({ conversationId, failed });

  const sendQueued = () => {
    const queue = useLangyMessageQueue.getState();
    const followUp = langyFollowUpOf(queue.takeAll(conversationId));
    queue.release(conversationId);
    if (followUp.text) void send(followUp.text, { askedFrom: "composer", images: followUp.images });
  };

  // The hold is read from the store, not this render: a failure holds it in the same commit.
  const idle = !isBusy && turnPhase === "idle";
  useEffect(() => {
    if (!waiting || !idle) return;
    if (failed || recovering) return;
    if (isQueueHeld({ held: useLangyMessageQueue.getState().held, conversationId })) return;
    sendQueued();
  });

  return {
    /** The queue waits for the person: the last turn failed or was stopped. */
    paused: waiting && idle && (held || failed) && !recovering,
    sendNow: sendQueued,
  };
}

/** Stop holds whatever is queued in the conversation, so it waits for Send now. */
export function holdQueueForStop(): void {
  const conversationId = useLangyStore.getState().activeConversationId;
  const queue = useLangyMessageQueue.getState();
  if (queue.messages.some((queued) => queued.conversationId === conversationId)) {
    queue.hold(conversationId);
  }
}
