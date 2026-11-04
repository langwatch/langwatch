/**
 * One click on an insight's action. Only the click handler sends: nothing runs on render, load
 * or poll. A click already on its way swallows the next one, so a double click sends once.
 * @see modules/insight/specs/insight-actions.feature
 */

import type { InsightActionRun } from "@langwatch/insight-contract";
import { useEffect, useRef } from "react";

import { type InsightSuccessNotice, useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

/** A random id per click; `getRandomValues` works where `randomUUID` needs a secure origin. */
function mintClickId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A click answered after the person left the page: they stay put, and learn where it went. */
const SENT_AFTER_LEAVING: InsightSuccessNotice = {
  title: "Langy has your action",
  description: "Find the conversation under Recent chats in the Langy panel.",
};

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

/**
 * For the screen to call, above whatever a read swaps out: a failed read, the skeleton and the
 * empty page all remove the list, and this hook's unmount is what says the person left the page.
 */
export function useRunInsightAction() {
  const host = useInsightHost();
  const isSending = useRef(false);
  const isOnPage = useRef(true);
  useEffect(() => {
    isOnPage.current = true;
    return () => {
      isOnPage.current = false;
    };
  }, []);
  // On the mutation, not on `mutate()`: those are dropped once the caller unmounts. Each render
  // hands the mutation on its way these options, so while on the page `host` reads the query now.
  const runAction = insightApi.insights.runAction.useMutation({
    onSuccess: (run) => {
      // A host from a page that is gone would write its old query over the page they moved to.
      if (isOnPage.current) host.openLangyConversation(run.conversationId);
      else host.succeeded(SENT_AFTER_LEAVING);
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
    run({
      projectId,
      insightId,
      actionId,
    }: {
      projectId: string;
      insightId: string;
      actionId: string;
    }) {
      if (isSending.current) return;
      isSending.current = true;
      runAction.mutate({ projectId, insightId, actionId, clickId: mintClickId() });
    },
  };
}
