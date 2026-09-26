import { useState } from "react";

import type { AiToolEntry } from "~/components/me/tiles/types";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

/**
 * The organization's AI tool registry, read and edited.
 *
 * Two surfaces drive the same registry — the catalog editor and the Inventory
 * page's Catalog pane — and both need the same admin list, the same
 * publish/unpublish, and the same permanent delete behind a confirmation. They
 * had one copy of that wiring between them until the Catalog pane came back;
 * a second copy is exactly the divergence that leaves one surface invalidating
 * a cache the other one reads.
 *
 * Reordering and the starter-pack import stay with the editor: they are that
 * screen's own job, and neither has a second caller to share them with.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
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
  const utils = api.useUtils();

  /**
   * Delete is permanent, so it routes through a confirm dialog. `null` means
   * no pending deletion; a non-null entry is the tool awaiting confirmation.
   * The dialog itself belongs to the caller — a hook returns state, never
   * markup — so both surfaces word the warning in their own terms.
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
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't update the tool" }),
  });

  const removeMutation = api.aiTools.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toaster.create({ title: "Tool removed", type: "success" });
      setPendingDelete(null);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't remove the tool" }),
  });

  return {
    /**
     * The registry as the admin surfaces read it: every live entry, published
     * or not. The router's payload is the service DTO, which carries the
     * extra audit columns the tile type does not name.
     */
    entries: (adminListQuery.data ?? []) as unknown as AiToolEntry[],
    /**
     * Whether the read has actually answered.
     *
     * `entries` defaults to an empty array so a renderer never has to guard,
     * and that default is a lie about an unanswered read: a caller counting it
     * would report "0 tools" for a registry it has not seen. This is the flag
     * that separates the two, and every count of this list is gated on it.
     */
    loaded: adminListQuery.data !== undefined,
    isLoading: adminListQuery.isLoading,
    error: adminListQuery.error,
    /**
     * The query itself, for the one caller that writes the cache directly:
     * the editor's drag-to-reorder paints the new order before the mutation
     * lands, and `setData` needs the router's own payload type, which only
     * the query carries.
     */
    query: adminListQuery,
    setEnabled: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setEnabledMutation.mutate({ organizationId, id, enabled }),
    /** The tool whose publish state is mid-flight, so its row can say so. */
    togglePendingId: setEnabledMutation.isPending
      ? setEnabledMutation.variables?.id
      : undefined,
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
