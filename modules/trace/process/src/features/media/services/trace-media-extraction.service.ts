/**
 * Externalises inline media under an explicit cost budget. The walk is pure (collect sites, then
 * rebuild clone-on-write); the only I/O is the store phase, run in bounded waves. The span path
 * around it lives in trace-span-media-extraction.service.ts.
 */

import { storedObjectFileReferenceOf } from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import { parseBase64DataUri } from "@langwatch/trace-contract";

import { mediaPartExtractionOf } from "../rules/media-part.rules.ts";
import { type ReplacedMediaSite, rebuildWithReplacements } from "../rules/media-rebuild.rules.ts";
import { type MediaSite, findMediaSites } from "../rules/media-sites.rules.ts";
import type { TraceMediaStore } from "./trace-media-store.service.ts";

/** At most this many parts are stored per span; the rest stay inline and the drop is counted. */
export const MAX_MEDIA_PARTS_PER_SPAN = 16;

/** Wall-clock budget for one span, well under SDK export deadlines: no store starts past it. */
const EXTRACTION_DEADLINE_MS = 5_000;

/** How long one started store may run, so an hour-long recording lands while a stuck one ends. */
const STORE_CEILING_MS = 30_000;

/** Storage calls in flight at once during the store phase. */
const CONCURRENT_STORES = 4;

/** One stored object created (or reused) during extraction. */
export type ExtractedRef = Readonly<{
  id: string;
  isDuplicate: boolean;
  purpose: string;
  ownerKind: string;
  ownerId: string;
}>;

/** The cost budget shared by every value of one span, so cap and deadline are per span. */
export interface ExtractionBudget {
  deadlineAt: number;
  storeCeilingMs: number;
  remainingParts: number;
  droppedByCap: number;
  droppedByDeadline: number;
  failedParts: number;
}

type SiteOutcome =
  | Readonly<{ status: "stored"; site: ReplacedMediaSite; ref: ExtractedRef }>
  | Readonly<{ status: "unchanged"; ref?: ExtractedRef }>;

const UNCHANGED: SiteOutcome = { status: "unchanged" };

/** A whole-string data URI routed through the part vocabulary, so audio gets the same WAV wrap. */
function partForDataUri(uri: string, mediaType: string, base64: string): unknown {
  if (mediaType.startsWith("audio/")) {
    return { type: "input_audio", input_audio: { data: base64, mimeType: mediaType } };
  }

  return mediaType.startsWith("image/")
    ? { type: "image_url", image_url: { url: uri } }
    : { type: "binary", mimeType: mediaType, data: base64 };
}

export class TraceMediaExtractionService {
  static create({ store }: { store: TraceMediaStore }): TraceMediaExtractionService {
    return new TraceMediaExtractionService(store);
  }

  private constructor(private readonly store: TraceMediaStore) {}

  createExtractionBudget(now: number = nowInstant().epochMilliseconds): ExtractionBudget {
    return {
      deadlineAt: now + EXTRACTION_DEADLINE_MS,
      storeCeilingMs: STORE_CEILING_MS,
      remainingParts: MAX_MEDIA_PARTS_PER_SPAN,
      droppedByCap: 0,
      droppedByDeadline: 0,
      failedParts: 0,
    };
  }

  /** Stores one part's inline bytes; the part comes back unchanged when it has none. Throws. */
  async extractFromPart({
    part,
    projectId,
    ownerId,
    retainFromMs,
  }: {
    part: unknown;
    projectId: string;
    ownerId: string;
    retainFromMs?: number | undefined;
  }): Promise<{ part: unknown; ref: ExtractedRef | undefined }> {
    const extraction = mediaPartExtractionOf(part);
    if (extraction.kind === "none") return { part, ref: undefined };
    const stored = await this.store.storeFromBytes({
      projectId,
      ownerId,
      mediaType: extraction.mediaType,
      bytes: extraction.bytes,
      ...(retainFromMs === undefined ? {} : { retainFromMs }),
    });
    const reference = storedObjectFileReferenceOf({ projectId, storedObjectId: stored.id });

    return {
      part: extraction.rewrite({ reference, storedObjectId: stored.id }),
      ref: {
        id: stored.id,
        isDuplicate: stored.isDuplicate,
        purpose: this.store.purpose,
        ownerKind: this.store.ownerKind,
        ownerId,
      },
    };
  }

  /**
   * `value` with its inline media externalised at any depth, under `budget` (a fresh one when
   * absent). A per-part store failure leaves that part inline and is counted on the budget.
   */
  async extractFromValue({
    value,
    projectId,
    ownerId,
    retainFromMs,
    budget = this.createExtractionBudget(),
  }: {
    value: unknown;
    projectId: string;
    ownerId: string;
    retainFromMs?: number | undefined;
    budget?: ExtractionBudget;
  }): Promise<{ value: unknown; refs: ExtractedRef[] }> {
    const sites = findMediaSites(value);
    if (sites.length === 0) return { value, refs: [] };
    const refs: ExtractedRef[] = [];
    const stored = await this.storeSites({ sites, projectId, ownerId, retainFromMs, budget, refs });
    if (stored.length === 0) return { value, refs };

    return { value: rebuildWithReplacements(value, stored), refs };
  }

  private async storeSite({
    site,
    projectId,
    ownerId,
    retainFromMs,
  }: {
    site: MediaSite;
    projectId: string;
    ownerId: string;
    retainFromMs?: number | undefined;
  }): Promise<SiteOutcome> {
    if (site.kind === "part") {
      const { part, ref } = await this.extractFromPart({
        part: site.node,
        projectId,
        ownerId,
        retainFromMs,
      });
      if (!ref || part === site.node) return ref ? { status: "unchanged", ref } : UNCHANGED;

      return { status: "stored", site: { ...site, replacement: part }, ref };
    }

    // The attribute stays a string: the whole value becomes the reference.
    const uri = site.node as string;
    const parsed = parseBase64DataUri(uri);
    if (!parsed) return UNCHANGED;
    const { ref } = await this.extractFromPart({
      part: partForDataUri(uri, parsed.mimeType, parsed.base64),
      projectId,
      ownerId,
      retainFromMs,
    });
    if (!ref) return UNCHANGED;

    return {
      status: "stored",
      site: {
        ...site,
        replacement: storedObjectFileReferenceOf({ projectId, storedObjectId: ref.id }),
      },
      ref,
    };
  }

  /**
   * One started store raced against the store ceiling, not the span's deadline (which only stops
   * new stores). A store past the ceiling stays inline and counts as a deadline drop; whatever it
   * answers later is ignored. A failure stays inline.
   */
  private async storeWithinCeiling(input: {
    site: MediaSite;
    projectId: string;
    ownerId: string;
    retainFromMs?: number | undefined;
    budget: ExtractionBudget;
  }): Promise<SiteOutcome> {
    const { budget } = input;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), budget.storeCeilingMs);
    });
    try {
      const outcome = await Promise.race([this.storeSite(input), late]);
      if (outcome !== "late") return outcome;
      budget.droppedByDeadline += 1;

      return UNCHANGED;
    } catch {
      // Per-part fail-open: this part stays inline; stored parts keep their references.
      budget.failedParts += 1;

      return UNCHANGED;
    } finally {
      clearTimeout(timer);
    }
  }

  private async storeSites({
    sites,
    projectId,
    ownerId,
    retainFromMs,
    budget,
    refs,
  }: {
    sites: MediaSite[];
    projectId: string;
    ownerId: string;
    retainFromMs?: number | undefined;
    budget: ExtractionBudget;
    refs: ExtractedRef[];
  }): Promise<ReplacedMediaSite[]> {
    let takeable = sites;
    if (sites.length > budget.remainingParts) {
      budget.droppedByCap += sites.length - budget.remainingParts;
      takeable = sites.slice(0, Math.max(0, budget.remainingParts));
    }

    budget.remainingParts -= takeable.length;
    const stored: ReplacedMediaSite[] = [];
    for (let i = 0; i < takeable.length; i += CONCURRENT_STORES) {
      if (nowInstant().epochMilliseconds > budget.deadlineAt) {
        budget.droppedByDeadline += takeable.length - i;
        break;
      }

      const wave = takeable.slice(i, i + CONCURRENT_STORES);
      const results = await Promise.all(
        wave.map((site) =>
          this.storeWithinCeiling({ site, projectId, ownerId, retainFromMs, budget }),
        ),
      );
      for (const result of results) {
        if (result.ref) refs.push(result.ref);
        if (result.status === "stored") stored.push(result.site);
      }
    }

    return stored;
  }
}
