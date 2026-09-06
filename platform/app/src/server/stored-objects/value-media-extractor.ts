/**
 * value-media-extractor.ts — finds inline media parts in an ARBITRARY JSON
 * value and externalizes them to stored objects, under an explicit cost
 * budget.
 *
 * The scenario path (`content-extractor.ts`) walks a known envelope:
 * `event.message` / `event.messages[]` → `content[]` → parts. Trace span
 * attributes have no such contract — the same media part can appear as:
 *
 *  - a message array:            [{role, content:[{type:"file", ...}]}]
 *  - a typed value envelope:     {type:"chat_messages", value:[...]}
 *  - a typed RAW value whose payload is a JSON *string*:
 *                                {type:"raw", value:"[{\"role\":...}]"}
 *  - a bare content array, a single message, a part nested inside a
 *    tool_result — at any depth — or a whole-attribute bare `data:` URI.
 *
 * Because this runs inside the synchronous collector request, the work is
 * done in three phases so the storage cost is bounded and concurrent:
 *
 *  1. SYNC COLLECT — walk the value (arrays, objects, media-marker-gated
 *     nested JSON strings) and record the location of every candidate part.
 *     An object is a candidate when the shared `visitContentPart` dispatcher
 *     recognizes it AND it carries inline bytes; url-only parts are already
 *     externalized and skipped. No I/O.
 *  2. STORE — externalize candidates through the same `processContentPart`
 *     the scenario extractor uses, in bounded-concurrency waves, respecting
 *     the caller's `ExtractionBudget`: a per-span part cap and a deadline.
 *     A part whose store fails (or that falls past the cap/deadline) simply
 *     stays inline — parts already stored keep their references, so no
 *     stored bytes are ever left unreferenced by a later failure.
 *  3. REBUILD — clone-on-write only along the paths of rewritten parts
 *     (re-serializing any nested JSON string boundary they sit behind), so
 *     an untouched subtree keeps reference identity and the caller can
 *     cheaply detect "no-op".
 *
 * Nested JSON strings are only parsed when `containsMediaMarkers` passes —
 * a linear scan for the part-type/base64 markers — so plain-text and
 * ordinary JSON payloads are never speculatively parsed. When a nested
 * string IS rewritten it is re-serialized with `JSON.stringify`, which may
 * normalize whitespace; acceptable because the content changed anyway.
 *
 * The walk mirrors the render-side collector (`shared/traces/mediaParts.ts`):
 * same depth ceiling, same part-first-stop rule, same generic recursion.
 * `media-walk-parity.unit.test.ts` pins the agreement.
 */

import { containsMediaMarkers } from "~/shared/content-parts/media-markers";
import {
  parseBase64DataUri,
  visitContentPart,
} from "~/shared/content-parts/visit-content-part";
import { MAX_MEDIA_WALK_DEPTH } from "~/shared/traces/mediaParts";
import { type ExtractedRef, processContentPart } from "./content-extractor";
import type { StoredObjectsService } from "./stored-objects.service";

/** Upper bound for parsing a nested JSON string (sanity guard, not a policy). */
const MAX_NESTED_JSON_BYTES = 50 * 1024 * 1024;

/**
 * At most this many parts are externalized per span. A realtime voice span
 * can carry hundreds of turns; storing them all inside the collector request
 * would serialize hundreds of storage round trips. Parts past the cap stay
 * inline and the drop is surfaced to the caller — never silent.
 */
export const MAX_MEDIA_PARTS_PER_SPAN = 16;

/**
 * Wall-clock budget for the whole span's extraction (all attribute values).
 * Once exceeded, no further parts are stored; parts already stored keep
 * their references. Sized well under typical SDK export deadlines (10-30s)
 * so a slow object store degrades to inline payloads instead of client
 * timeouts and re-sent batches.
 */
export const EXTRACTION_DEADLINE_MS = 5_000;

/** Storage calls in flight at once during the store phase. */
const CONCURRENT_STORES = 4;

/**
 * Mutable cost budget threaded through one span's extraction. Create with
 * `createExtractionBudget()` and share across every attribute value of the
 * span so the cap and deadline are per-span, not per-attribute.
 */
export interface ExtractionBudget {
  deadlineAt: number;
  remainingParts: number;
  droppedByCap: number;
  droppedByDeadline: number;
  failedParts: number;
}

export function createExtractionBudget(
  now: number = Date.now(),
): ExtractionBudget {
  return {
    deadlineAt: now + EXTRACTION_DEADLINE_MS,
    remainingParts: MAX_MEDIA_PARTS_PER_SPAN,
    droppedByCap: 0,
    droppedByDeadline: 0,
    failedParts: 0,
  };
}

interface WalkParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: StoredObjectsService;
}

// ---------------------------------------------------------------------------
// Phase 1 — sync candidate collection
// ---------------------------------------------------------------------------

/**
 * One path step from the root value to a candidate: an object key, an array
 * index, or a hop through a parsed JSON string boundary.
 */
type PathSeg = { key: string } | { index: number } | { json: true };

interface CandidateSite {
  path: PathSeg[];
  node: unknown;
  kind: "part" | "bareDataUri";
}

/**
 * True when the object IS a media part carrying inline bytes — i.e. the
 * shapes `processContentPart` would externalize. Url-only parts (already
 * externalized) and non-part objects return false. Uses the same
 * `visitContentPart` dispatcher as the store phase, so the two cannot
 * disagree on shape vocabulary — only on the payload-presence checks below,
 * which the parity test pins against `processContentPart`'s behavior.
 */
export function isExtractableMediaPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false;
  return (
    visitContentPart<boolean>(part, {
      text: () => false,
      toolCall: () => false,
      toolResult: () => false,
      media: (p) =>
        p.source.type === "data" &&
        typeof p.source.value === "string" &&
        typeof p.source.mimeType === "string",
      binary: (p) =>
        p.data !== undefined && p.url === undefined && p.id === undefined,
      imageUrl: (url) => parseBase64DataUri(url) !== null,
      bareImage: (src) => parseBase64DataUri(src) !== null,
      inputAudio: (p) => typeof p.data === "string",
      unknown: () => false,
    }) ?? false
  );
}

/** A string whose ENTIRE value is one base64 `data:` URI. */
function isBareDataUri(value: string): boolean {
  return (
    value.startsWith("data:") &&
    !/\s/.test(value) &&
    parseBase64DataUri(value) !== null
  );
}

function collectCandidates(
  value: unknown,
  depth: number,
  path: PathSeg[],
  sites: CandidateSite[],
): void {
  if (value == null || depth > MAX_MEDIA_WALK_DEPTH) return;

  if (typeof value === "string") {
    if (isBareDataUri(value)) {
      sites.push({ path, node: value, kind: "bareDataUri" });
      return;
    }
    if (
      value.length < 2 ||
      value.length > MAX_NESTED_JSON_BYTES ||
      !containsMediaMarkers(value)
    ) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    collectCandidates(parsed, depth + 1, [...path, { json: true }], sites);
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectCandidates(value[i], depth + 1, [...path, { index: i }], sites);
    }
    return;
  }

  if (typeof value === "object") {
    // Part-first: a media part is a leaf — the rewritten reference has
    // nothing left to extract inside it, so we never descend into parts.
    if (isExtractableMediaPart(value)) {
      sites.push({ path, node: value, kind: "part" });
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      collectCandidates(obj[key], depth + 1, [...path, { key }], sites);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — bounded-concurrency store
// ---------------------------------------------------------------------------

interface StoredSite extends CandidateSite {
  replacement: unknown;
}

async function processSite(
  site: CandidateSite,
  params: WalkParams,
  refs: ExtractedRef[],
): Promise<StoredSite | null> {
  if (site.kind === "bareDataUri") {
    const uri = site.node as string;
    const parsed = parseBase64DataUri(uri);
    if (!parsed) return null;
    // Route the payload through the part vocabulary so audio gets the same
    // store-time WAV wrap (and mime handling) as an explicit part would.
    const asPart = parsed.mimeType.startsWith("audio/")
      ? {
          type: "input_audio",
          input_audio: { data: parsed.base64, mimeType: parsed.mimeType },
        }
      : parsed.mimeType.startsWith("image/")
        ? { type: "image_url", image_url: { url: uri } }
        : {
            type: "binary",
            mimeType: parsed.mimeType,
            data: parsed.base64,
          };
    const { ref } = await processContentPart({ part: asPart, ...params });
    if (ref === null) return null;
    refs.push(ref);
    // The attribute stays a string: rewrite the whole value to the minted
    // reference URL (the render-side collector surfaces bare reference
    // strings symmetrically).
    return {
      ...site,
      replacement: `/api/files/${params.projectId}/${ref.id}`,
    };
  }

  const { part, ref } = await processContentPart({
    part: site.node,
    ...params,
  });
  if (ref !== null) refs.push(ref);
  if (part === site.node) return null;
  return { ...site, replacement: part };
}

async function storeCandidates(
  sites: CandidateSite[],
  params: WalkParams,
  budget: ExtractionBudget,
  refs: ExtractedRef[],
): Promise<StoredSite[]> {
  let takeable = sites;
  if (sites.length > budget.remainingParts) {
    budget.droppedByCap += sites.length - budget.remainingParts;
    takeable = sites.slice(0, Math.max(0, budget.remainingParts));
  }
  budget.remainingParts -= takeable.length;

  const stored: StoredSite[] = [];
  for (let i = 0; i < takeable.length; i += CONCURRENT_STORES) {
    if (Date.now() > budget.deadlineAt) {
      budget.droppedByDeadline += takeable.length - i;
      break;
    }
    const wave = takeable.slice(i, i + CONCURRENT_STORES);
    const results = await Promise.all(
      wave.map(async (site) => {
        try {
          return await processSite(site, params, refs);
        } catch {
          // Per-part fail-open: this part stays inline; parts already stored
          // keep their references, so nothing orphans.
          budget.failedParts += 1;
          return null;
        }
      }),
    );
    for (const result of results) {
      if (result !== null) stored.push(result);
    }
  }
  return stored;
}

// ---------------------------------------------------------------------------
// Phase 3 — clone-on-write rebuild
// ---------------------------------------------------------------------------

function rebuild(
  value: unknown,
  sites: StoredSite[],
  segIndex: number,
): unknown {
  const direct = sites.find((site) => site.path.length === segIndex);
  if (direct) return direct.replacement;

  if (typeof value === "string") {
    // All remaining sites hop through this string's JSON boundary.
    const inner = sites.filter((site) => "json" in site.path[segIndex]!);
    if (inner.length === 0) return value;
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(rebuild(parsed, inner, segIndex + 1));
  }

  if (Array.isArray(value)) {
    const out = [...value];
    const byIndex = new Map<number, StoredSite[]>();
    for (const site of sites) {
      const seg = site.path[segIndex]!;
      if ("index" in seg) {
        const group = byIndex.get(seg.index) ?? [];
        group.push(site);
        byIndex.set(seg.index, group);
      }
    }
    for (const [index, group] of byIndex) {
      out[index] = rebuild(out[index], group, segIndex + 1);
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    const out = { ...(value as Record<string, unknown>) };
    const byKey = new Map<string, StoredSite[]>();
    for (const site of sites) {
      const seg = site.path[segIndex]!;
      if ("key" in seg) {
        const group = byKey.get(seg.key) ?? [];
        group.push(site);
        byKey.set(seg.key, group);
      }
    }
    for (const [key, group] of byKey) {
      out[key] = rebuild(out[key], group, segIndex + 1);
    }
    return out;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walks `value` (any JSON-compatible value, or a JSON string) and
 * externalizes inline media parts found at any depth, including through
 * media-marker-gated nested JSON strings and whole-string `data:` URIs.
 *
 * Storage runs in bounded-concurrency waves under `budget` (a per-span cap
 * and deadline shared across a span's attribute values — pass the same
 * budget object to every call for one span). Per-part store failures are
 * fail-open: the failed part stays inline, `budget.failedParts` is
 * incremented, and every part stored before the failure keeps its reference.
 *
 * Returns the original `value` reference when nothing was rewritten.
 */
export async function extractInlineMediaFromValue({
  value,
  projectId,
  purpose,
  ownerKind,
  ownerId,
  service,
  budget,
}: WalkParams & {
  value: unknown;
  budget?: ExtractionBudget;
}): Promise<{
  value: unknown;
  refs: ExtractedRef[];
}> {
  const sites: CandidateSite[] = [];
  collectCandidates(value, 0, [], sites);
  if (sites.length === 0) return { value, refs: [] };

  const refs: ExtractedRef[] = [];
  const stored = await storeCandidates(
    sites,
    { projectId, purpose, ownerKind, ownerId, service },
    budget ?? createExtractionBudget(),
    refs,
  );
  if (stored.length === 0) return { value, refs };

  return { value: rebuild(value, stored, 0), refs };
}
