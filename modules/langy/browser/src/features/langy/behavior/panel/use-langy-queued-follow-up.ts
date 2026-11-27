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

/**
 * A new chat's turn named its conversation: what was queued in it goes with it. Picking another
 * conversation instead leaves that queue with the new chat, held for Send now.
 */
function useQueueFollowsAdoptedConversation(conversationId: string | null) {
  const previous = useRef(conversationId);
  useEffect(() => {
    if (previous.current === null && conversationId) {
      const picked = useLangyStore.getState().historyLoadConversationId === conversationId;
      const queue = useLangyMessageQueue.getState();
      if (picked) holdIfQueued({ conversationId: null });
      else queue.adopt(conversationId);
    }
    previous.current = conversationId;
  }, [conversationId]);
}

function holdIfQueued({ conversationId }: { conversationId: string | null }): void {
  const queue = useLangyMessageQueue.getState();
  if (queue.messages.some((queued) => queued.conversationId === conversationId)) {
    queue.hold(conversationId);
  }
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

/** Everything queued in the conversation goes as one turn, leaving the person's typing alone. */
function sendFollowUp({
  projectId,
  conversationId,
  send,
}: {
  projectId: string | undefined;
  conversationId: string | null;
  send: LangyPanelSend;
}): void {
  if (!projectId) return;
  const queue = useLangyMessageQueue.getState();
  const followUp = langyFollowUpOf(queue.takeAll(conversationId));
  queue.release(conversationId);
  if (!followUp.text) return;
  void send(followUp.text, { askedFrom: "composer", images: followUp.images, keepDraft: true });
}

export function useLangyQueuedFollowUp({
  projectId,
  isBusy,
  failed,
  recovering,
  send,
}: {
  /** No project, no send: the queue stays put until there is one. */
  projectId: string | undefined;
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

  const sendQueued = () => sendFollowUp({ projectId, conversationId, send });

  // The hold is read from the store, not this render: a failure holds it in the same commit.
  const idle = !isBusy && turnPhase === "idle";
  useEffect(() => {
    if (!waiting || !idle) return;
    if (failed || recovering || !projectId) return;
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
  holdIfQueued({ conversationId: useLangyStore.getState().activeConversationId });
}
