import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Write commands for Langy conversations, through the defined tRPC API.
 *
 * The whole Langy conversation surface — the `langy.list` / `langy.messages`
 * reads AND this delete — goes through one tRPC router (never an ad-hoc client
 * `fetch`). `remove` calls `langy.deleteConversation`, which dispatches the
 * event-sourced archive command server-side, then invalidates the React Query
 * list cache so the recents list drops the row without a bespoke local edit.
 */
export function useLangyConversationCommands(): {
  remove: (id: string) => Promise<void>;
} {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const deleteConversation = api.langy.deleteConversation.useMutation({
    onSuccess: (_result, variables) => {
      void utils.langy.list.invalidate({ projectId: variables.projectId });
    },
  });

  const remove = useCallback(
    async (id: string) => {
      const projectId = project?.id;
      if (!projectId) return;
      await deleteConversation.mutateAsync({ projectId, conversationId: id });
    },
    [project?.id, deleteConversation],
  );

  return { remove };
}
