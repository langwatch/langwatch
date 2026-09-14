import { useMemo, useRef } from "react";
import type { TraceHeader } from "@langwatch/trace-contract";

interface RetainedFields {
  traceId: string;
  attributes: TraceHeader["attributes"];
  conversationId: string | null;
  userId: string | null;
}

/**
 * Prevent "chips flash then vanish": retain header seeded from table row across
 * cache swaps during row-click / URL-hydration / refetch sequence.
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
