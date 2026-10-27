import { useEffect } from "react";

import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useConversationContext } from "./use-conversation-context.ts";

/** How long to wait after a trace settles before warming siblings. */
const PREFETCH_DELAY_MS = 600;
/** Maximum sibling distance to prefetch in either direction. */
const RADIUS = 5;
/**
 * Sibling distance that gets the full (untruncated) prefetch instead of the cheap
 * preview.
 */
const NEAR_RADIUS = 1;

/**
 * Eagerly prefetch sibling trace headers in the same conversation, expanding outward
 * from the current turn. Spans are intentionally NOT prefetched — they're heavy and
 * only needed once the user actually navigates there.
 */
export function useConversationPrefetch(
  conversationId: string | null | undefined,
  currentTraceId: string | null | undefined,
): void {
  // A conversation's turns belong to the member the drawer is on.
  const { projectId, tenantId } = useTraceQueryArgs();
  const { turns } = useConversationContext(conversationId, currentTraceId);
  const utils = api.useUtils();

  useEffect(() => {
    if (!projectId || !currentTraceId || turns.length === 0) return;

    const idx = turns.findIndex((t) => t.traceId === currentTraceId);
    if (idx === -1) return;

    const order = radialOrder(turns.length, idx, RADIUS).filter((i) => i !== idx);
    if (order.length === 0) return;

    // A conversation's turns belong to the member the drawer is on.
    const tenantArg = tenantId !== null ? { tenantId } : {};
    const timer = setTimeout(() => {
      prefetchTurnHeaders({ order, turns, idx, projectId, tenantArg, utils });
    }, PREFETCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [projectId, tenantId, currentTraceId, turns, utils]);
}

type Utils = ReturnType<typeof api.useUtils>;

function prefetchTurnHeaders({
  order,
  turns,
  idx,
  projectId,
  tenantArg,
  utils,
}: {
  order: number[];
  turns: ReturnType<typeof useConversationContext>["turns"];
  idx: number;
  projectId: string;
  tenantArg: { tenantId?: string };
  utils: Utils;
}): void {
  for (const i of order) {
    const turn = turns[i];
    if (!turn) continue;
    // Fire and forget. tRPC's prefetch is a no-op when the entry is already fresh
    // in cache, so subsequent passes don't re-hit the server.
    void utils.traces.header.prefetch({
      projectId,
      traceId: turn.traceId,
      occurredAtMs: turn.timestamp,
      ...tenantArg,
      full: Math.abs(i - idx) <= NEAR_RADIUS,
    });
  }
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
