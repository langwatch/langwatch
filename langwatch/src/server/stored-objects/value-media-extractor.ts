/**
 * value-media-extractor.ts — finds inline media parts in an ARBITRARY JSON
 * value and externalizes them to stored objects.
 *
 * The scenario path (`content-extractor.ts`) walks a known envelope:
 * `event.message` / `event.messages[]` → `content[]` → parts. Trace span
 * attributes have no such contract — the same media part can appear as:
 *
 *  - a message array:            [{role, content:[{type:"file", ...}]}]
 *  - a typed value envelope:     {type:"chat_messages", value:[...]}
 *  - a typed RAW value whose payload is a JSON *string*:
 *                                {type:"raw", value:"[{\"role\":...}]"}
 *  - a bare content array, a single message, or a part nested inside a
 *    tool_result — at any depth.
 *
 * This walker recurses through arrays, plain objects, and (media-marker
 * gated) nested JSON strings, dispatching every node through the same
 * `processContentPart` the scenario extractor uses. Only positively
 * identified media parts are rewritten; everything else keeps reference
 * identity, so an untouched subtree re-serializes byte-identical and the
 * caller can cheaply detect "no-op".
 *
 * Nested JSON strings are only parsed when `containsMediaMarkers` passes —
 * a linear scan for the part-type/base64 markers — so plain-text and
 * ordinary JSON payloads are never speculatively parsed. When a nested
 * string IS rewritten it is re-serialized with `JSON.stringify`, which may
 * normalize whitespace; acceptable because the content changed anyway.
 */

import { type ExtractedRef, processContentPart } from "./content-extractor";
import { containsMediaMarkers } from "./media-markers";
import type { StoredObjectsService } from "./stored-objects.service";

/** Recursion ceiling across objects/arrays AND nested-JSON-string hops. */
const MAX_WALK_DEPTH = 8;

/** Upper bound for parsing a nested JSON string (sanity guard, not a policy). */
const MAX_NESTED_JSON_BYTES = 50 * 1024 * 1024;

interface WalkParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: StoredObjectsService;
}

async function walkValue(
  value: unknown,
  depth: number,
  params: WalkParams,
  refs: ExtractedRef[],
): Promise<unknown> {
  if (depth > MAX_WALK_DEPTH) return value;

  if (typeof value === "string") {
    if (
      value.length < 2 ||
      value.length > MAX_NESTED_JSON_BYTES ||
      !containsMediaMarkers(value)
    ) {
      return value;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
    if (typeof parsed !== "object" || parsed === null) return value;
    const walked = await walkValue(parsed, depth + 1, params, refs);
    if (walked === parsed) return value;
    return JSON.stringify(walked);
  }

  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const walked = await walkValue(value[i], depth + 1, params, refs);
      if (walked !== value[i]) changed = true;
      out[i] = walked;
    }
    return changed ? out : value;
  }

  if (typeof value === "object" && value !== null) {
    // Part-first: if this object IS a media part, rewrite it and stop —
    // the rewritten reference has nothing left to extract inside it.
    const { part, ref } = await processContentPart({ part: value, ...params });
    if (ref !== null || part !== value) {
      if (ref !== null) refs.push(ref);
      return part;
    }

    // Not a media part — recurse into its properties (message envelopes,
    // typed values, tool results, anything).
    let changed = false;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const walked = await walkValue(obj[key], depth + 1, params, refs);
      if (walked !== obj[key]) changed = true;
      out[key] = walked;
    }
    return changed ? out : value;
  }

  return value;
}

/**
 * Walks `value` (any JSON-compatible value, or a JSON string) and
 * externalizes every inline media part found, at any depth, including
 * through media-marker-gated nested JSON strings.
 *
 * Returns the original `value` reference when nothing was extracted.
 * `storeFromBytes` failures propagate — callers decide fail-open/closed.
 */
export async function extractInlineMediaFromValue({
  value,
  projectId,
  purpose,
  ownerKind,
  ownerId,
  service,
}: WalkParams & { value: unknown }): Promise<{
  value: unknown;
  refs: ExtractedRef[];
}> {
  const refs: ExtractedRef[] = [];
  const walked = await walkValue(
    value,
    0,
    { projectId, purpose, ownerKind, ownerId, service },
    refs,
  );
  return { value: walked, refs };
}
