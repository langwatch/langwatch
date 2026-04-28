import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useThreadContext } from "./useThreadContext";

/** How long to wait after a trace settles before warming siblings. */
const PREFETCH_DELAY_MS = 600;
/** Maximum sibling distance to prefetch in either direction. */
const RADIUS = 5;

/**
 * Eagerly prefetch sibling trace headers in the same conversation, expanding
 * outward from the current turn. Spans are intentionally NOT prefetched —
 * they're heavy and only needed once the user actually navigates there.
 *
 * Runs after `PREFETCH_DELAY_MS` so the active trace's own queries finish
 * first; cancels if the user navigates away before the timer fires.
 */
export function useThreadPrefetch(
  conversationId: string | null | undefined,
  currentTraceId: string | null | undefined,
): void {
  const { project } = useOrganizationTeamProject();
  const { turns } = useThreadContext(conversationId, currentTraceId);
  const utils = api.useContext();
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId || !currentTraceId || turns.length === 0) return;

    const idx = turns.findIndex((t) => t.traceId === currentTraceId);
    if (idx === -1) return;

    const order = radialOrder(turns.length, idx, RADIUS).filter(
      (i) => i !== idx,
    );
    if (order.length === 0) return;

    const timer = setTimeout(() => {
      for (const i of order) {
        const turn = turns[i];
        if (!turn) continue;
        // Fire and forget. tRPC's prefetch is a no-op when the entry is
        // already fresh in cache, so subsequent passes don't re-hit the
        // server.
        void utils.tracesV2.header.prefetch({
          projectId,
          traceId: turn.traceId,
          occurredAtMs: turn.timestamp,
        });
      }
    }, PREFETCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [projectId, currentTraceId, turns, utils]);
}

/**
 * Radially-ordered indices around `center` within `[0, length)`.
 * Example: length=10, center=5, radius=3 → [5, 4, 6, 3, 7, 2, 8].
 * Stops at array bounds; never returns duplicates.
 */
function radialOrder(length: number, center: number, radius: number): number[] {
  const out: number[] = [];
  if (length === 0) return out;
  out.push(center);
  for (let d = 1; d <= radius; d++) {
    const left = center - d;
    const right = center + d;
    if (left >= 0) out.push(left);
    if (right < length) out.push(right);
  }
  return out;
}
