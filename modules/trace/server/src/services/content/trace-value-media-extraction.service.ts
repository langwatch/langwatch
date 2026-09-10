/**
 * Finds inline media parts anywhere in an arbitrary JSON value and externalizes them under an
 * explicit cost budget, in three bounded phases: collect candidate locations with no I/O, store
 * them in bounded-concurrency waves, then rebuild clone-on-write along rewritten paths only.
 */

import { TraceContentExtractionService } from "./trace-content-extraction.service.ts";
import { containsMediaMarkers } from "@langwatch/trace-contract";
import { parseBase64DataUri, visitContentPart } from "@langwatch/trace-contract";
import { MAX_MEDIA_WALK_DEPTH } from "@langwatch/trace-contract";
import type { ExtractedRef } from "../../rules/content-part-extraction.rules.ts";
import type { TraceMediaStore } from "../../app/trace.infrastructure.ts";
import { nowInstant } from "@langwatch/time";

/** Upper bound for parsing a nested JSON string (sanity guard, not a policy). */
const MAX_NESTED_JSON_BYTES = 50 * 1024 * 1024;

/**
 * At most this many parts are externalized per span. A realtime voice span can carry hundreds of
 * turns, and storing them all inside the collector request would serialize hundreds of storage
 * round trips. Parts past the cap stay inline, and the drop is surfaced to the caller.
 */
export const MAX_MEDIA_PARTS_PER_SPAN = 16;

/**
 * Wall-clock budget for the whole span's extraction. Once exceeded no further parts are stored and
 * those already stored keep their references. Sized well under typical SDK export deadlines, so a
 * slow object store degrades to inline payloads instead of client timeouts and re-sent batches.
 */
export const EXTRACTION_DEADLINE_MS = 5_000;

/** Storage calls in flight at once during the store phase. */
const CONCURRENT_STORES = 4;

/**
 * Mutable cost budget threaded through one span's extraction. Create with
 * `TraceValueMediaExtractionService.createExtractionBudget()` and share across every attribute
 * value of the span so the cap and deadline are per-span, not per-attribute.
 */
export interface ExtractionBudget {
  deadlineAt: number;
  remainingParts: number;
  droppedByCap: number;
  droppedByDeadline: number;
  failedParts: number;
}

interface WalkParams {
  projectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  service: TraceMediaStore;
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

/** A string whose ENTIRE value is one base64 `data:` URI. */
function isBareDataUri(value: string): boolean {
  return value.startsWith("data:") && !/\s/.test(value) && parseBase64DataUri(value) !== null;
}

/** A string is a bare data URI leaf, or an envelope whose JSON may hold parts. */
function collectFromString(
  value: string,
  depth: number,
  path: PathSeg[],
  sites: CandidateSite[],
): void {
  if (isBareDataUri(value)) {
    sites.push({ path, node: value, kind: "bareDataUri" });

    return;
  }

  const worthParsing =
    value.length >= 2 && value.length <= MAX_NESTED_JSON_BYTES && containsMediaMarkers(value);
  if (!worthParsing) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return;
  }

  collectCandidates(parsed, depth + 1, [...path, { json: true }], sites);
}

/**
 * Part-first: a media part is a leaf — the rewritten reference has nothing left to extract
 * inside it, so the walk never descends into parts.
 */
function collectFromObject(
  value: object,
  depth: number,
  path: PathSeg[],
  sites: CandidateSite[],
): void {
  if (TraceValueMediaExtractionService.isExtractableMediaPart(value)) {
    sites.push({ path, node: value, kind: "part" });

    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    collectCandidates(obj[key], depth + 1, [...path, { key }], sites);
  }
}

function collectCandidates(
  value: unknown,
  depth: number,
  path: PathSeg[],
  sites: CandidateSite[],
): void {
  if (value == null || depth > MAX_MEDIA_WALK_DEPTH) {
    return;
  }

  if (typeof value === "string") {
    collectFromString(value, depth, path, sites);

    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectCandidates(value[i], depth + 1, [...path, { index: i }], sites);
    }

    return;
  }

  if (typeof value === "object") {
    collectFromObject(value, depth, path, sites);
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
    if (!parsed) {
      return null;
    }

    // Route the payload through the part vocabulary so audio gets the same
    // store-time WAV wrap (and mime handling) as an explicit part would.
    const imageOrBinaryPart = parsed.mimeType.startsWith("image/")
      ? { type: "image_url", image_url: { url: uri } }
      : {
          type: "binary",
          mimeType: parsed.mimeType,
          data: parsed.base64,
        };
    const asPart = parsed.mimeType.startsWith("audio/")
      ? {
          type: "input_audio",
          input_audio: { data: parsed.base64, mimeType: parsed.mimeType },
        }
      : imageOrBinaryPart;
    const { ref } = await TraceContentExtractionService.processContentPart({
      part: asPart,
      ...params,
    });
    if (ref === null) {
      return null;
    }

    refs.push(ref);

    // The attribute stays a string: rewrite the whole value to the minted
    // reference URL (the render-side collector surfaces bare reference
    // strings symmetrically).
    return {
      ...site,
      replacement: `/api/files/${params.projectId}/${ref.id}`,
    };
  }

  const { part, ref } = await TraceContentExtractionService.processContentPart({
    part: site.node,
    ...params,
  });
  if (ref !== null) {
    refs.push(ref);
  }

  if (part === site.node) {
    return null;
  }

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
    if (nowInstant().epochMilliseconds > budget.deadlineAt) {
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
      if (result !== null) {
        stored.push(result);
      }
    }
  }

  return stored;
}

// ---------------------------------------------------------------------------
// Phase 3 — clone-on-write rebuild
// ---------------------------------------------------------------------------

/** Groups the sites still in play by the array index or object key they descend through. */
function groupSitesBySegment<K extends number | string>(
  sites: StoredSite[],
  segIndex: number,
  read: (seg: PathSeg) => K | undefined,
): Map<K, StoredSite[]> {
  const grouped = new Map<K, StoredSite[]>();
  for (const site of sites) {
    const key = read(site.path[segIndex]!);
    if (key === undefined) {
      continue;
    }

    const group = grouped.get(key) ?? [];
    group.push(site);
    grouped.set(key, group);
  }

  return grouped;
}

function rebuild(value: unknown, sites: StoredSite[], segIndex: number): unknown {
  const direct = sites.find((site) => site.path.length === segIndex);
  if (direct) {
    return direct.replacement;
  }

  if (typeof value === "string") {
    // All remaining sites hop through this string's JSON boundary.
    const inner = sites.filter((site) => "json" in site.path[segIndex]!);
    if (inner.length === 0) {
      return value;
    }

    const parsed: unknown = JSON.parse(value);

    return JSON.stringify(rebuild(parsed, inner, segIndex + 1));
  }

  if (Array.isArray(value)) {
    return rebuildArray(value, sites, segIndex);
  }

  if (typeof value === "object" && value !== null) {
    return rebuildObject(value as Record<string, unknown>, sites, segIndex);
  }

  return value;
}

function rebuildArray(value: unknown[], sites: StoredSite[], segIndex: number): unknown[] {
  const out = [...value];
  const byIndex = groupSitesBySegment(sites, segIndex, (seg) =>
    "index" in seg ? seg.index : undefined,
  );
  for (const [index, group] of byIndex) {
    out[index] = rebuild(out[index], group, segIndex + 1);
  }

  return out;
}

function rebuildObject(
  value: Record<string, unknown>,
  sites: StoredSite[],
  segIndex: number,
): Record<string, unknown> {
  const out = { ...value };
  const byKey = groupSitesBySegment(sites, segIndex, (seg) => ("key" in seg ? seg.key : undefined));
  for (const [key, group] of byKey) {
    out[key] = rebuild(out[key], group, segIndex + 1);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class TraceValueMediaExtractionService {
  static create(): TraceValueMediaExtractionService {
    return new TraceValueMediaExtractionService();
  }

  static createExtractionBudget(now: number = nowInstant().epochMilliseconds): ExtractionBudget {
    return {
      deadlineAt: now + EXTRACTION_DEADLINE_MS,
      remainingParts: MAX_MEDIA_PARTS_PER_SPAN,
      droppedByCap: 0,
      droppedByDeadline: 0,
      failedParts: 0,
    };
  }

  /**
   * True when the object is a media part carrying inline bytes, the shapes the content extraction
   * service would externalize; url-only and non-part objects are false. It uses the same
   * `visitContentPart` dispatcher as the store phase, so the two cannot disagree on shape.
   */
  static isExtractableMediaPart(part: unknown): boolean {
    if (typeof part !== "object" || part === null) {
      return false;
    }

    return (
      visitContentPart<boolean>(part, {
        text: () => false,
        toolCall: () => false,
        toolResult: () => false,
        media: (p) =>
          p.source.type === "data" &&
          typeof p.source.value === "string" &&
          typeof p.source.mimeType === "string",
        binary: (p) => p.data !== undefined && p.url === undefined && p.id === undefined,
        imageUrl: (url) => parseBase64DataUri(url) !== null,
        bareImage: (src) => parseBase64DataUri(src) !== null,
        inputAudio: (p) => typeof p.data === "string",
        unknown: () => false,
      }) ?? false
    );
  }

  /**
   * Walks `value` and externalizes inline media parts at any depth, through marker-gated nested
   * JSON strings and whole-string `data:` URIs alike. Storage runs in bounded waves under `budget`,
   * shared across a span's attribute values; a per-part store failure leaves that part inline.
   */
  static async extractInlineMediaFromValue({
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
    if (sites.length === 0) {
      return { value, refs: [] };
    }

    const refs: ExtractedRef[] = [];
    const stored = await storeCandidates(
      sites,
      { projectId, purpose, ownerKind, ownerId, service },
      budget ?? TraceValueMediaExtractionService.createExtractionBudget(),
      refs,
    );
    if (stored.length === 0) {
      return { value, refs };
    }

    return { value: rebuild(value, stored, 0), refs };
  }
}
