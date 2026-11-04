/**
 * One click on an insight's action. Only the click handler sends: nothing runs on render, load
 * or poll. A click already on its way swallows the next one, so a double click sends once.
 * @see modules/insight/specs/insight-actions.feature
 */

import type { InsightActionRun } from "@langwatch/insight-contract";
import { useRef } from "react";

import { type InsightSuccessNotice, useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

/** A random id per click; `getRandomValues` works where `randomUUID` needs a secure origin. */
function mintClickId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What the person is told when the turn is not in the conversation they expected. */
function noticeOf({
  sourceGone,
  forkNotReady,
  forkTitle,
}: InsightActionRun): InsightSuccessNotice | null {
  if (forkNotReady) {
    const copy = forkTitle ? `A copy named "${forkTitle}"` : "A copy";
    return {
      title: "Langy started a new conversation from this insight",
      description: `The copy of the original did not get ready in time. ${copy} may still appear in your conversation list.`,
    };
  }
  if (sourceGone) {
    return {
      title: "The original conversation is gone",
      description: "Langy started a new one from this insight.",
    };
  }
  return null;
}

export function useRunInsightAction({ projectId }: { projectId: string }) {
  const host = useInsightHost();
  const isSending = useRef(false);
  // On the mutation, not on `mutate()`: those are dropped once the caller unmounts, and a person
  // who leaves the page while it sends still gets their conversation.
  const runAction = insightApi.insights.runAction.useMutation({
    onSuccess: (run) => {
      host.openLangyConversation(run.conversationId);
      const notice = noticeOf(run);
      if (notice) host.succeeded(notice);
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't send this action to Langy" }),
    onSettled: () => {
      isSending.current = false;
    },
  });

  return {
    /** A click on some insight's action is on its way; every action waits for it. */
    isSending: runAction.isPending,
    /** The action of this insight whose click is on its way, if any. */
    pendingActionId: (insightId: string): string | null =>
      runAction.isPending && runAction.variables?.insightId === insightId
        ? runAction.variables.actionId
        : null,
    run({ insightId, actionId }: { insightId: string; actionId: string }) {
      if (isSending.current) return;
      isSending.current = true;
      runAction.mutate({ projectId, insightId, actionId, clickId: mintClickId() });
    },
  };
}
