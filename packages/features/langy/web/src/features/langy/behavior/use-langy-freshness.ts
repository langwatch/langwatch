import { useCallback } from "react";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { api } from "../../../behavior/langy-api";
import type { LangyConversationUpdateSignal } from "@langwatch/langy-contract";
import { catchUpConversationFold } from "./logic/langy-durable-catch-up";
import { useLangyDevLog } from "./stores/langy-dev-log";
import { useLangyConversationUpdateListener } from "./use-langy-conversation-update-listener";

/**
 * Page-level real-time coordinator for Langy, mirroring `useTraceFreshness`.
 */
export function useLangyFreshness(activeConversationId: string | null): void {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();

  const onConversationUpdated = useCallback(
    (signals: LangyConversationUpdateSignal[]) => {
      const projectId = project?.id;
      if (!projectId) return;

      for (const signal of signals) {
        useLangyDevLog.getState().recordSignal({
          conversationId: signal.conversationId,
          cursor: signal.cursor ?? null,
        });
        if (signal.conversationId === activeConversationId) {
          // The OPEN conversation's live path (ADR-059): the signal carries the projection's CURSOR; `catchUpConversationFold`
          // compares it with the local fold's and, when behind, fetches the durable event tail and folds it in place — turn state
          // lands event-by-event without re-downloading the projection.
          catchUpConversationFold({
            utils: trpcUtils,
            projectId,
            conversationId: signal.conversationId,
            targetCursor: signal.cursor ?? null,
          }).catch(() => {
            // A failed catch-up must not strand the open thread — fall back to
            // the plain refetch the signal used to mean.
            void trpcUtils.langy.messages.invalidate({
              projectId,
              conversationId: signal.conversationId,
            });
          });
        }
      }

      // The list carries no content and the signal no spine, so a change always
      // routes through a single server-gated refetch per debounced batch.
      void trpcUtils.langy.list.cancel();
      void trpcUtils.langy.list.invalidate();
    },
    [trpcUtils, project?.id, activeConversationId],
  );

  useLangyConversationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    onConversationUpdated,
    debounceMs: 1500,
    maxWaitMs: 1500,
  });
}
