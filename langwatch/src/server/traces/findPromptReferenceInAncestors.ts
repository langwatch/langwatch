import {
  parsePromptReference,
  type PromptReference,
} from "./parsePromptReference";

/**
 * Span shape used for prompt reference lookup.
 * Includes startTime to determine the closest preceding sibling.
 */
export interface PromptLookupSpan {
  spanId: string;
  parentSpanId: string | null;
  startTime: number;
  attributes: Record<string, unknown>;
}

/**
 * Prompt-relevant attribute keys that parsePromptReference reads.
 * Used to selectively extract only these from nested params objects.
 */
const PROMPT_ATTRIBUTE_KEYS = [
  "langwatch.prompt.id",
  "langwatch.prompt.handle",
  "langwatch.prompt.version.number",
  "langwatch.prompt.variables",
] as const;

/**
 * Converts nested span params (e.g. `{ langwatch: { prompt: { id: "..." } } }`)
 * to the flat dot-notation attributes expected by parsePromptReference
 * (e.g. `{ "langwatch.prompt.id": "..." }`).
 *
 * Only extracts prompt-relevant keys to keep the mapping minimal and safe.
 *
 * @param params - Nested params object from an ES or frontend span
 * @returns Flat attributes record with dot-notation keys
 */
export function flattenParamsToPromptAttributes(
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!params) return {};

  const attrs: Record<string, unknown> = {};

  for (const key of PROMPT_ATTRIBUTE_KEYS) {
    const segments = key.split(".");
    let current: unknown = params;
    for (const segment of segments) {
      if (typeof current !== "object" || current === null) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (current !== undefined) {
      attrs[key] = current;
    }
  }

  return attrs;
}

/**
 * Finds the nearest prompt reference relative to a target span by searching
 * both ancestors and their children (siblings/cousins of the target).
 *
 * Algorithm:
 * 1. Walk up the parent chain from the target span.
 * 2. At each ancestor, find its children (excluding the current path) that
 *    have a prompt reference AND started BEFORE the target span.
 * 3. Among matches, pick the one with the latest startTime (closest preceding).
 * 4. If found, return it. Otherwise check the ancestor itself, then continue up.
 *
 * This handles the common SDK pattern where `langwatch.prompt.id` is on
 * `Prompt.compile` or `PromptApiService.get` spans that are siblings of the
 * LLM span, not parents.
 *
 * @param params.targetSpanId - The span to start searching from
 * @param params.spans - All spans in the trace
 * @returns The closest preceding PromptReference, or null if none found
 */
export function findPromptReferenceInAncestors({
  targetSpanId,
  spans,
}: {
  targetSpanId: string;
  spans: PromptLookupSpan[];
}): PromptReference | null {
  const spanMap = new Map(spans.map((s) => [s.spanId, s]));

  const targetSpan = spanMap.get(targetSpanId);
  if (!targetSpan) {
    return null;
  }

  const targetStartTime = targetSpan.startTime;

  // Build a parent-to-children index for efficient sibling lookup.
  const childrenByParent = new Map<string, PromptLookupSpan[]>();
  for (const span of spans) {
    if (span.parentSpanId) {
      const siblings = childrenByParent.get(span.parentSpanId);
      if (siblings) {
        siblings.push(span);
      } else {
        childrenByParent.set(span.parentSpanId, [span]);
      }
    }
  }

  // Walk up the parent chain from the target span.
  // Track visited IDs to guard against malformed cyclic parent chains.
  const visited = new Set<string>([targetSpanId]);
  let currentId: string | null = targetSpan.parentSpanId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const ancestor = spanMap.get(currentId);
    if (!ancestor) break;

    // Check children of this ancestor (siblings of the current path)
    // that have a prompt ref and started before the target span.
    const siblingRef = findClosestPrecedingSibling({
      parentId: currentId,
      childrenByParent,
      targetStartTime,
      excludeSpanIds: visited,
    });
    if (siblingRef) {
      return siblingRef;
    }

    // Fall back to checking the ancestor itself (old behavior).
    const ancestorRef = parsePromptReference(ancestor.attributes);
    if (ancestorRef.promptHandle) {
      return ancestorRef;
    }

    currentId = ancestor.parentSpanId;
  }

  return null;
}

/**
 * Among the children of a given parent, finds the one with a prompt reference
 * that started most recently before the target span's startTime.
 */
function findClosestPrecedingSibling({
  parentId,
  childrenByParent,
  targetStartTime,
  excludeSpanIds,
}: {
  parentId: string;
  childrenByParent: Map<string, PromptLookupSpan[]>;
  targetStartTime: number;
  excludeSpanIds: Set<string>;
}): PromptReference | null {
  const children = childrenByParent.get(parentId);
  if (!children) return null;

  let bestRef: PromptReference | null = null;
  let bestStartTime = -Infinity;

  for (const child of children) {
    if (excludeSpanIds.has(child.spanId)) continue;
    if (child.startTime >= targetStartTime) continue;

    const ref = parsePromptReference(child.attributes);
    if (ref.promptHandle && child.startTime > bestStartTime) {
      bestRef = ref;
      bestStartTime = child.startTime;
    }
  }

  return bestRef;
}
