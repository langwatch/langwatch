import { useCallback } from "react";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { api } from "../../../behavior/langy-api.ts";
import type { LangyConversationUpdateSignal } from "@langwatch/langy-contract";
import { catchUpConversationFold } from "./logic/langy-durable-catch-up.ts";
import { useLangyDevLog } from "./stores/langy-dev-log.ts";
import { useLangyConversationUpdateListener } from "./use-langy-conversation-update-listener.ts";

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
          // The open conversation's record (ADR-129) is not part of the turn fold, so a folder
          // connect needs its own invalidate — one small read per signal batch, already debounced.
          void trpcUtils.langy.localRecord.invalidate({
            projectId,
            conversationId: signal.conversationId,
          });
          // The open conversation's live path (ADR-059): `catchUpConversationFold` compares the
          // signal's cursor with the local fold's and, when behind, folds in the event tail.
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
