import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

/**
 * Returns a callback that prefetches span detail for a given span id under
 * the currently-open trace. Wire it up to onMouseEnter/onFocus on span rows
 * (waterfall, span list, span tabs) so detail is already cached by the time
 * the user clicks.
 */
export function usePrefetchSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const utils = api.useUtils();

  return useCallback(
    (spanId: string) => {
      if (!project?.id || !traceId || !spanId) return;
      void utils.tracesV2.spanDetail.prefetch(
        { projectId: project.id, traceId, spanId },
        { staleTime: 300_000 },
      );
    },
    [project?.id, traceId, utils],
  );
}
