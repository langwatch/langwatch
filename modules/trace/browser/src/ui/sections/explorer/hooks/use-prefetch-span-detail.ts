import { useCallback } from "react";

import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";

/**
 * Returns a callback that prefetches span detail for a given span id under the
 * currently-open trace. Wire it up to onMouseEnter/onFocus on span rows (waterfall,
 * span list, span tabs) so detail is already cached by the time the user clicks.
 */
export function usePrefetchSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useTraceDrawer((s) => s.traceId);
  const occurredAtMs = useTraceDrawer((s) => s.occurredAtMs);
  const utils = api.useUtils();

  return useCallback(
    (spanId: string) => {
      if (!project?.id || !traceId || !spanId) return;
      void utils.traces.spanDetail.prefetch({
        projectId: project.id,
        traceId,
        spanId,
        ...(occurredAtMs !== null ? { occurredAtMs } : {}),
      });
    },
    [project?.id, traceId, occurredAtMs, utils],
  );
}
