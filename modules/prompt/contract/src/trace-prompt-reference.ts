import {
  type ParsedPromptTraceReference as PromptReference,
  parsePromptTraceReference,
} from "./prompt.trace-reference.ts";

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
 * Prompt-relevant attribute keys that parsePromptTraceReference reads.
 * Used to selectively extract only these from nested params objects.
 */
const PROMPT_ATTRIBUTE_KEYS = [
  "langwatch.prompt.id",
  "langwatch.prompt.handle",
  "langwatch.prompt.version.number",
  "langwatch.prompt.variables",
] as const;

/** Flatten nested span params to dot-notation attributes for prompt trace reference parsing. */
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

/** Find nearest prompt reference by walking up ancestors and checking their children. */
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
    const ancestorRef = parsePromptTraceReference(ancestor.attributes);
    if (ancestorRef.promptHandle) {
      return ancestorRef;
    }

    currentId = ancestor.parentSpanId;
  }

  return null;
}

/** Find closest preceding sibling with prompt ref; merge variables across siblings. */
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

    const ref = parsePromptTraceReference(child.attributes);
    if (ref.promptHandle) {
      preceding.push({ ref, startTime: child.startTime });
    }
  }

  if (preceding.length === 0) return null;

  preceding.sort((a, b) => a.startTime - b.startTime);

  const identity = preceding[preceding.length - 1]!.ref;
  const mergedVariables = mergeVariables(preceding.map((p) => p.ref));
  return {
    ...identity,
    // The reference carries `null` for "this span declared no variables", so
    // an empty merge is written back as that rather than as an empty panel.
    promptVariables: Object.keys(mergedVariables).length > 0 ? mergedVariables : null,
  };
}

/** SDK dispatch envelope keys; filtered out to keep Variables panel noise-free on resume. */
const INTERNAL_PROMPT_VARIABLE_KEYS = new Set<string>([
  "prompt_id",
  "tag",
  "messages",
  "chat_messages",
]);

/** Union prompt variables across refs (later wins); skip dispatch-internal keys. */
function mergeVariables(refs: PromptReference[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const r of refs) {
    if (!r.promptVariables) continue;
    for (const [k, v] of Object.entries(r.promptVariables)) {
      if (INTERNAL_PROMPT_VARIABLE_KEYS.has(k)) continue;
      merged[k] = v;
    }
  }
  return merged;
}
