/**
 * One click on an insight's action. Only the click handler sends: nothing runs on render, load
 * or poll. A click already on its way swallows the next one, so a double click sends once.
 * @see modules/insight/specs/insight-actions.feature
 */

import { useRef } from "react";

import { useInsightHost } from "../model/insight-host.ts";
import { insightApi } from "./insight-api.ts";

/** A random id per click; `getRandomValues` works where `randomUUID` needs a secure origin. */
function mintClickId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useRunInsightAction({ projectId }: { projectId: string }) {
  const host = useInsightHost();
  const runAction = insightApi.insights.runAction.useMutation();
  const isSending = useRef(false);

  return {
    /** The action of this insight whose click is on its way, if any. */
    pendingActionId: (insightId: string): string | null =>
      runAction.isPending && runAction.variables?.insightId === insightId
        ? runAction.variables.actionId
        : null,
    run({ insightId, actionId }: { insightId: string; actionId: string }) {
      if (isSending.current) return;
      isSending.current = true;
      runAction.mutate(
        { projectId, insightId, actionId, clickId: mintClickId() },
        {
          onSuccess: ({ conversationId, sourceGone }) => {
            host.openLangyConversation(conversationId);
            if (sourceGone) {
              host.succeeded({
                title: "The original conversation is gone",
                description: "Langy started a new one from this insight.",
              });
            }
          },
          onError: (error) =>
            host.failed({ error, fallbackTitle: "Couldn't send this action to Langy" }),
          onSettled: () => {
            isSending.current = false;
          },
        },
      );
    },
  };
}
