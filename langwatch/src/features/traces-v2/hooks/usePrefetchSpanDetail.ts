import { useCallback } from "react";
import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

/**
 * Returns a callback that prefetches span detail for a given span id under
 * the currently-open trace. Wire it up to onMouseEnter/onFocus on span rows
 * (waterfall, span list, span tabs) so detail is already cached by the time
 * the user clicks.
 */
export function usePrefetchSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = parseOccurredAtMs(useDrawerParams().t);
  const utils = api.useUtils();

  return useCallback(
    (spanId: string) => {
      if (!project?.id || !traceId || !spanId) return;
      void utils.tracesV2.spanDetail.prefetch(
        {
          projectId: project.id,
          traceId,
          spanId,
          ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
        },
        { staleTime: 300_000 },
      );
    },
    [project?.id, traceId, occurredAtMs, utils],
  );
}
