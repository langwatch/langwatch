import { useMemo, useRef } from "react";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";

interface RetainedFields {
  traceId: string;
  attributes: TraceHeader["attributes"];
  conversationId: string | null;
  userId: string | null;
}

/**
 * Root cause of the "chips flash then vanish" bug: the drawer opens
 * against a header *seeded from the table row* (`useOpenTraceDrawer`
 * calls `header.setData` with `attributes: {}` but real
 * `conversationId` / `userId`), and the row-click / URL-hydration /
 * refetch sequence can swap which cache entry (with vs. without the
 * `occurredAtMs` key part) backs `useTraceHeader`. Whenever a payload
 * for the *same* trace lands with an empty `attributes` map (the seed)
 * or a null `conversationId` / `userId` after a richer payload already
 * rendered, every attribute-derived chip (Conversation, User,
 * `metadata.*` auto-pins, user pins) unmounts for a beat — the
 * half-second "chips disappear" the user reported.
 *
 * This hook gives those fields keep-previous-data semantics scoped to
 * the traceId: once a non-empty `attributes` map (or non-null
 * conversation / user id) has been seen for a trace, later payloads
 * for the same trace can only *update* the value, never blank it.
 * Switching to a different traceId resets the retention so stale
 * chips never leak across traces.
 */
export function useRetainedTraceHeader(trace: TraceHeader): TraceHeader {
  const retained = useRef<RetainedFields | null>(null);

  if (!retained.current || retained.current.traceId !== trace.traceId) {
    retained.current = {
      traceId: trace.traceId,
      attributes: trace.attributes,
      conversationId: trace.conversationId,
      userId: trace.userId,
    };
  } else {
    // Only ever upgrade: a non-empty attributes map replaces whatever we
    // held (fresher data wins), but an empty map never clobbers a
    // previously-seen non-empty one.
    if (Object.keys(trace.attributes).length > 0) {
      retained.current.attributes = trace.attributes;
    }
    if (trace.conversationId != null) {
      retained.current.conversationId = trace.conversationId;
    }
    if (trace.userId != null) {
      retained.current.userId = trace.userId;
    }
  }

  const { attributes, conversationId, userId } = retained.current;

  return useMemo(() => {
    if (
      trace.attributes === attributes &&
      trace.conversationId === conversationId &&
      trace.userId === userId
    ) {
      return trace;
    }
    return { ...trace, attributes, conversationId, userId };
  }, [trace, attributes, conversationId, userId]);
}
