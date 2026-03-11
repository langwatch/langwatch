import {
  parsePromptReference,
  type PromptReference,
} from "./parsePromptReference";

/**
 * Span shape used for ancestor prompt reference lookup.
 * Only the fields needed for parent-chain walking and attribute extraction.
 */
interface AncestorSpan {
  spanId: string;
  parentSpanId: string | null;
  attributes: Record<string, unknown>;
}

/**
 * Walks up the parent chain from a target span to find the nearest ancestor
 * with a prompt reference (`langwatch.prompt.id` or the old separate format).
 *
 * Skips the target span itself (already checked by the caller).
 * Only walks ancestors (parent, grandparent, etc.), not siblings or children.
 *
 * @param params.targetSpanId - The span to start walking up from
 * @param params.spans - All spans in the trace
 * @returns The first ancestor's PromptReference, or null if none found
 */
export function findPromptReferenceInAncestors({
  targetSpanId,
  spans,
}: {
  targetSpanId: string;
  spans: AncestorSpan[];
}): PromptReference | null {
  const spanMap = new Map(spans.map((s) => [s.spanId, s]));

  const targetSpan = spanMap.get(targetSpanId);
  if (!targetSpan) {
    return null;
  }

  // Start from the target span's parent (skip the target itself)
  let currentId: string | null = targetSpan.parentSpanId;

  while (currentId) {
    const current = spanMap.get(currentId);
    if (!current) break;

    const ref = parsePromptReference(current.attributes);
    if (ref.promptHandle) {
      return ref;
    }

    currentId = current.parentSpanId;
  }

  return null;
}
