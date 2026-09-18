import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import type { AiToolEntry } from "../../model/ai-tool-tile.ts";

/** Shared hook for AI tool registry; used by catalog editor and Inventory pane. */
export function useAiToolCatalog({
  organizationId,
  enabled = true,
}: {
  organizationId: string;
  /**
   * Whether to issue the read at all. The admin list needs `aiTools:manage`,
   * so a surface that renders for readers without it passes `false` and shows
   * its permission notice rather than firing a request that can only 403.
   */
  enabled?: boolean;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const utils = api.useUtils();

  /**
   * Delete is permanent, routed through a confirm dialog. `null` means no
   * pending deletion; a non-null entry awaits confirmation. The dialog
   * belongs to the caller — a hook returns state, never markup.
   */
  const [pendingDelete, setPendingDelete] = useState<AiToolEntry | null>(null);

  const adminListQuery = api.aiTools.adminList.useQuery(
    { organizationId },
    { enabled: enabled && !!organizationId, refetchOnWindowFocus: false },
  );

  /**
   * Both lists, every time. The admin list is what these surfaces read and
   * the user list is what the personal portal reads, and a tool published
   * here must not stay missing from a portal that is already open.
   */
  const invalidate = () => {
    void utils.aiTools.adminList.invalidate({ organizationId });
    void utils.aiTools.list.invalidate({ organizationId });
  };

  const setEnabledMutation = api.aiTools.setEnabled.useMutation({
    onSuccess: invalidate,
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't update the tool" }),
  });

  const removeMutation = api.aiTools.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toaster.create({ title: "Tool removed", type: "success" });
      setPendingDelete(null);
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't remove the tool" }),
  });

  return {
    /**
     * The registry as the admin surfaces read it: every live entry, published
     * or not. The router's payload is the service DTO, which carries the
     * extra audit columns the tile type does not name.
     */
    entries: (adminListQuery.data ?? []) as unknown as AiToolEntry[],
    /**
     * Whether the read has actually answered. `entries` defaults to an
     * empty array so a renderer never has to guard — but a caller counting
     * it would report "0 tools" for a registry it hasn't seen without this flag.
     */
    loaded: adminListQuery.data !== undefined,
    isLoading: adminListQuery.isLoading,
    error: adminListQuery.error,
    /**
     * The query itself, for the one caller that writes the cache directly:
     * the editor's drag-to-reorder paints the new order before the mutation
     * lands, needing the router's own payload type only the query carries.
     */
    query: adminListQuery,
    setEnabled: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setEnabledMutation.mutate({ organizationId, id, enabled }),
    /** The tool whose publish state is mid-flight, so its row can say so. */
    togglePendingId: setEnabledMutation.isPending ? setEnabledMutation.variables?.id : undefined,
    pendingDelete,
    setPendingDelete,
    confirmDelete: () => {
      if (pendingDelete) {
        removeMutation.mutate({ organizationId, id: pendingDelete.id });
      }
    },
    isRemoving: removeMutation.isPending,
    invalidate,
  };
}
