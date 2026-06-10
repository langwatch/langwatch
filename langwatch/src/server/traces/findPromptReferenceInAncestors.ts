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
    // Flat-keyed shape first (`params["langwatch.prompt.id"]`) — that's
    // how OTel attributes land before ingestion un-flattens them, and
    // some SDK paths leave them as-is. Fall back to nested walk after.
    if (params[key] !== undefined) {
      attrs[key] = params[key];
      continue;
    }
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
 * Among the children of a given parent, finds the closest preceding sibling
 * with a prompt reference AND merges variables across all matching preceding
 * siblings. The "closest preceding" sibling supplies the prompt identity
 * (handle, version, tag, versionId). Variables from earlier siblings are
 * unioned underneath later ones — later wins on key collision.
 *
 * Why the merge: the python-sdk emits prompts as a pair of sibling spans —
 * `PromptApiService.get` first, then `Prompt.compile` — both carry a
 * prompt reference, both have their own `langwatch.prompt.variables`. Get's
 * variables map carries the dispatch internals (e.g. `prompt_id`), compile's
 * carries the user's actual template kwargs. ClickHouse stores StartTime at
 * millisecond resolution, so the two spans typically share the same
 * `startTime` — strict greater-than tie-breaking made get win on iteration
 * order, dropping the user-facing variables from compile and leaving the
 * playground variables panel empty.
 *
 * Same-millisecond siblings are included because SDK patterns like
 * `Prompt.compile` and the LLM span often start at the exact same ms.
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

  // Collect every preceding sibling that resolves to a prompt reference,
  // ordered by startTime ascending. The last entry supplies the identity;
  // every entry contributes its variables (later overrides earlier).
  const preceding: Array<{ ref: PromptReference; startTime: number }> = [];
  for (const child of children) {
    if (excludeSpanIds.has(child.spanId)) continue;
    if (child.startTime > targetStartTime) continue;

    const ref = parsePromptReference(child.attributes);
    if (ref.promptHandle) {
      preceding.push({ ref, startTime: child.startTime });
    }
  }

  if (preceding.length === 0) return null;

  preceding.sort((a, b) => a.startTime - b.startTime);

  const identity = preceding[preceding.length - 1]!.ref;
  const mergedVariables = mergeVariables(preceding.map((p) => p.ref));
  return { ...identity, promptVariables: mergedVariables };
}

/**
 * Keys that the python-sdk emits onto `langwatch.prompt.variables` as
 * part of the dispatch envelope rather than as user template variables.
 * Surfacing them in the playground's Variables panel on resume creates
 * meaningless rows ("prompt_id = prompt_gg9YhtFllFNrMixRXXslv", "messages
 * = [object Object]") — caught in the 2026-05-17 post-merge dogfood.
 *
 * Sources:
 *  - `prompt_id` + `tag`: kwargs python's PromptApiService.get records
 *    onto its variables map (prompt_service_tracing.py).
 *  - `messages` + `chat_messages`: conversation history the
 *    PromptStudioAdapter / Studio engine injects into the signature
 *    node's inputs alongside user vars; nlpgo's filter strips them on
 *    emit going forward but old traces still carry them.
 *
 * Filtering at the merger (rather than at parse) keeps the user's
 * intent crystal clear in storage — the trace still records what the
 * SDK actually sent — and only hides the noise at the resume UI.
 */
const INTERNAL_PROMPT_VARIABLE_KEYS = new Set<string>([
  "prompt_id",
  "tag",
  "messages",
  "chat_messages",
]);

/**
 * Union prompt variables across multiple references in iteration order.
 * Later entries override earlier on key collision (so compile beats get
 * on overlap, and a stale ancestor never displaces a fresh closer match).
 * Dispatch-internal keys (see {@link INTERNAL_PROMPT_VARIABLE_KEYS}) are
 * skipped — they belong to the SDK's call envelope, not the prompt's
 * declared variables. Returns null only when every remaining entry is
 * null/empty.
 */
function mergeVariables(
  refs: PromptReference[],
): Record<string, string> | null {
  const merged: Record<string, string> = {};
  for (const r of refs) {
    if (!r.promptVariables) continue;
    for (const [k, v] of Object.entries(r.promptVariables)) {
      if (INTERNAL_PROMPT_VARIABLE_KEYS.has(k)) continue;
      merged[k] = v;
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
