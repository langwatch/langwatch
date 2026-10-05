import {
  HELPER_THREAD_ID_ATTR,
  isCodexScope,
  isCodexTemporaryStructuredRequestSpan,
  queuedThreadIdOf,
  REQUEST_QUEUE_SPAN_NAME,
} from "@langwatch/coding-agent-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";

import { OtlpTraceRequestService } from "../services/otlp-trace-request.service.ts";

/** The parsed spans of one instrumentation scope entry of an export request. */
export type ScopedSpans = {
  scopeName: string | null | undefined;
  spans: OtlpSpan[];
};

function stringAttributes(span: OtlpSpan): Record<string, unknown> {
  return Object.fromEntries(span.attributes.map((a) => [a.key, a.value.stringValue]));
}

/**
 * The helper thread each codex request span was issued for, keyed by request span id. The span
 * carries the mark (scope-gated per entry), its queue child the thread id (matched by parent id
 * across every entry). A request with no child maps to nothing.
 */
export function codexHelperThreadMarkersOf({
  scopes,
}: {
  scopes: ScopedSpans[];
}): Map<string, string> {
  const requestSpanIds = codexRequestSpanIds({ scopes });
  const markers = new Map<string, string>();
  if (requestSpanIds.size === 0) return markers;
  for (const span of scopes.flatMap((scope) => scope.spans)) {
    addQueueChildMarker({ span, requestSpanIds, markers });
  }
  return markers;
}

function codexRequestSpanIds({ scopes }: { scopes: ScopedSpans[] }): Set<string> {
  const requestSpanIds = new Set<string>();
  for (const { scopeName, spans } of scopes) {
    if (!isCodexScope(scopeName)) continue;
    for (const span of spans) {
      if (
        isCodexTemporaryStructuredRequestSpan({ scopeName, attributes: stringAttributes(span) })
      ) {
        requestSpanIds.add(OtlpTraceRequestService.normalizeOtlpId(span.spanId));
      }
    }
  }
  return requestSpanIds;
}

function addQueueChildMarker({
  span,
  requestSpanIds,
  markers,
}: {
  span: OtlpSpan;
  requestSpanIds: Set<string>;
  markers: Map<string, string>;
}): void {
  if (span.name !== REQUEST_QUEUE_SPAN_NAME || !span.parentSpanId) return;
  const parentId = OtlpTraceRequestService.normalizeOtlpId(span.parentSpanId);
  if (!requestSpanIds.has(parentId)) return;
  const threadId = queuedThreadIdOf({ key: stringAttributes(span).key });
  if (threadId) markers.set(parentId, threadId);
}

/** The request span with its helper's thread id, the stamp that admits it past the noise filter. */
export function stampCodexHelperThread({
  span,
  threadId,
}: {
  span: OtlpSpan;
  threadId: string;
}): OtlpSpan {
  return {
    ...span,
    attributes: [
      ...span.attributes,
      { key: HELPER_THREAD_ID_ATTR, value: { stringValue: threadId } },
    ],
  };
}
