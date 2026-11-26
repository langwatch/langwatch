/**
 * Externalises inline media under an explicit cost budget. The walk is pure (collect sites, then
 * rebuild clone-on-write); the only I/O is the store phase, run in bounded waves. A span runs
 * markers, then the flag, then the privacy probe, then the walk, and is fail-open throughout.
 */

import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { type OtlpKeyValue, type OtlpSpan } from "@langwatch/otlp/trace-request";
import { storedObjectFileReferenceOf } from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import {
  type RecordSpanCommandData,
  containsMediaMarkers,
  parseBase64DataUri,
} from "@langwatch/trace-contract";

import { mediaPartExtractionOf } from "../rules/media-part.rules.ts";
import { type ReplacedMediaSite, rebuildWithReplacements } from "../rules/media-rebuild.rules.ts";
import { type MediaSite, findMediaSites } from "../rules/media-sites.rules.ts";
import type { TraceEdgeMediaTelemetry } from "./trace-edge-media-telemetry.service.ts";
import type { TraceMediaStore } from "./trace-media-store.service.ts";

/** At most this many parts are stored per span; the rest stay inline and the drop is counted. */
export const MAX_MEDIA_PARTS_PER_SPAN = 16;

/** Wall-clock budget for one span, well under SDK export deadlines. */
const EXTRACTION_DEADLINE_MS = 5_000;

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
  remainingParts: number;
  droppedByCap: number;
  droppedByDeadline: number;
  failedParts: number;
}

/** Structured logger surface the span path reports through. */
export interface EdgeMediaExtractionLogger {
  info(context: Record<string, unknown>, msg: string): void;
  warn(context: Record<string, unknown>, msg: string): void;
}

/** What decides whether a span's media is extracted at all. */
export type EdgeMediaExtractionPolicy = Readonly<{
  featureFlags: FeatureFlagApi;
  /** Required: a default of `false` would store media a content-drop policy then discards. */
  hasContentDropRules: (projectId: string) => Promise<boolean>;
}>;

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

function attributesCarryMarkers(attributes: OtlpKeyValue[] | undefined): boolean {
  return (
    Array.isArray(attributes) &&
    attributes.some(
      (attr) =>
        typeof attr?.value?.stringValue === "string" &&
        containsMediaMarkers(attr.value.stringValue),
    )
  );
}

export class TraceMediaExtractionService {
  static create({
    store,
    telemetry,
    logger,
  }: {
    store: TraceMediaStore;
    telemetry: TraceEdgeMediaTelemetry;
    logger: EdgeMediaExtractionLogger;
  }): TraceMediaExtractionService {
    return new TraceMediaExtractionService(store, telemetry, logger);
  }

  private constructor(
    private readonly store: TraceMediaStore,
    private readonly telemetry: TraceEdgeMediaTelemetry,
    private readonly logger: EdgeMediaExtractionLogger,
  ) {}

  createExtractionBudget(now: number = nowInstant().epochMilliseconds): ExtractionBudget {
    return {
      deadlineAt: now + EXTRACTION_DEADLINE_MS,
      remainingParts: MAX_MEDIA_PARTS_PER_SPAN,
      droppedByCap: 0,
      droppedByDeadline: 0,
      failedParts: 0,
    };
  }

  /** True when any span or span-event attribute string carries a media marker. No I/O. */
  spanCarriesMediaMarkers(span: OtlpSpan): boolean {
    if (attributesCarryMarkers(span.attributes)) return true;

    return (span.events ?? []).some((event) => attributesCarryMarkers(event.attributes));
  }

  /** Stores one part's inline bytes; the part comes back unchanged when it has none. Throws. */
  async extractFromPart({
    part,
    projectId,
    ownerId,
  }: {
    part: unknown;
    projectId: string;
    ownerId: string;
  }): Promise<{ part: unknown; ref: ExtractedRef | undefined }> {
    const extraction = mediaPartExtractionOf(part);
    if (extraction.kind === "none") return { part, ref: undefined };
    const stored = await this.store.storeFromBytes({
      projectId,
      ownerId,
      mediaType: extraction.mediaType,
      bytes: extraction.bytes,
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
    budget = this.createExtractionBudget(),
  }: {
    value: unknown;
    projectId: string;
    ownerId: string;
    budget?: ExtractionBudget;
  }): Promise<{ value: unknown; refs: ExtractedRef[] }> {
    const sites = findMediaSites(value);
    if (sites.length === 0) return { value, refs: [] };
    const refs: ExtractedRef[] = [];
    const stored = await this.storeSites({ sites, projectId, ownerId, budget, refs });
    if (stored.length === 0) return { value, refs };

    return { value: rebuildWithReplacements(value, stored), refs };
  }

  /**
   * The span with its inline media externalised, or the original command data when there is no
   * media, the flag is off, the project drops content, or anything fails.
   */
  async extractFromSpan({
    data,
    policy,
  }: {
    data: RecordSpanCommandData;
    policy: EdgeMediaExtractionPolicy;
  }): Promise<RecordSpanCommandData> {
    const span = data.span;
    if (!this.spanCarriesMediaMarkers(span)) return data;
    const projectId = data.tenantId;
    let stage: "flag_store" | "privacy_probe" | "storage" = "flag_store";
    try {
      const enabled = await policy.featureFlags.isEnabled("release_trace_media_extraction", {
        kind: "project",
        projectId,
      });
      if (!enabled) return data;
      stage = "privacy_probe";
      if (await policy.hasContentDropRules(projectId)) return data;
      stage = "storage";

      return await this.externaliseSpanMedia(data);
    } catch (err) {
      this.telemetry.failOpen(stage);
      this.logger.warn(
        {
          projectId,
          traceId: span.traceId,
          spanId: span.spanId,
          reason: stage,
          error: err instanceof Error ? err.message : String(err),
        },
        "Edge media extraction failed — falling back to unmodified command data (fail-open)",
      );

      return data;
    }
  }

  private async storeSite({
    site,
    projectId,
    ownerId,
  }: {
    site: MediaSite;
    projectId: string;
    ownerId: string;
  }): Promise<SiteOutcome> {
    if (site.kind === "part") {
      const { part, ref } = await this.extractFromPart({ part: site.node, projectId, ownerId });
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
   * One store raced against the time left to the deadline. A late store stays inline and
   * counts as a deadline drop; whatever it answers later is ignored. A failure stays inline.
   */
  private async storeBeforeDeadline(input: {
    site: MediaSite;
    projectId: string;
    ownerId: string;
    budget: ExtractionBudget;
  }): Promise<SiteOutcome> {
    const { budget } = input;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      const leftMs = Math.max(0, budget.deadlineAt - nowInstant().epochMilliseconds);
      timer = setTimeout(() => resolve("late"), leftMs);
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
    budget,
    refs,
  }: {
    sites: MediaSite[];
    projectId: string;
    ownerId: string;
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
        wave.map((site) => this.storeBeforeDeadline({ site, projectId, ownerId, budget })),
      );
      for (const result of results) {
        if (result.ref) refs.push(result.ref);
        if (result.status === "stored") stored.push(result.site);
      }
    }

    return stored;
  }

  /** One budget covers the whole span, so spreading media over attributes cannot multiply cost. */
  private async externaliseSpanMedia(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const span = data.span;
    const projectId = data.tenantId;
    const refs: ExtractedRef[] = [];
    const budget = this.createExtractionBudget();
    const walk = { projectId, ownerId: span.traceId, refs, budget };
    const attributes = await this.rewriteAttributeList({ attributes: span.attributes, ...walk });

    let eventsChanged = false;
    const events = [...(span.events ?? [])];
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const rewritten = await this.rewriteAttributeList({ attributes: event.attributes, ...walk });
      if (rewritten !== event.attributes) {
        eventsChanged = true;
        events[i] = { ...event, attributes: rewritten };
      }
    }

    this.reportBudgetDrops({ budget, refs, data });
    if (attributes === span.attributes && !eventsChanged) return data;

    this.logger.info(
      {
        projectId,
        traceId: span.traceId,
        spanId: span.spanId,
        storedObjectIds: refs.map((ref) => ref.id),
        dedupHits: refs.filter((ref) => ref.isDuplicate).length,
      },
      `span media extraction externalized ${refs.length} stored object(s)`,
    );

    return { ...data, span: { ...span, attributes, ...(eventsChanged ? { events } : {}) } };
  }

  private async rewriteAttributeList({
    attributes,
    projectId,
    ownerId,
    refs,
    budget,
  }: {
    attributes: OtlpKeyValue[];
    projectId: string;
    ownerId: string;
    refs: ExtractedRef[];
    budget: ExtractionBudget;
  }): Promise<OtlpKeyValue[]> {
    let changed = false;
    const out: OtlpKeyValue[] = [];
    for (const attr of attributes) {
      const stringValue = attr?.value?.stringValue;
      if (typeof stringValue === "string" && containsMediaMarkers(stringValue)) {
        const result = await this.extractFromValue({
          value: stringValue,
          projectId,
          ownerId,
          budget,
        });
        if (typeof result.value === "string" && result.value !== stringValue) {
          changed = true;
          refs.push(...result.refs);
          out.push({ ...attr, value: { ...attr.value, stringValue: result.value } });
          continue;
        }
      }

      out.push(attr);
    }

    return changed ? out : attributes;
  }

  /** Budget drops are fail-open per part but never silent: each reason is counted and logged. */
  private reportBudgetDrops({
    budget,
    refs,
    data,
  }: {
    budget: ExtractionBudget;
    refs: ExtractedRef[];
    data: RecordSpanCommandData;
  }): void {
    if (budget.droppedByCap === 0 && budget.droppedByDeadline === 0 && budget.failedParts === 0) {
      return;
    }

    if (budget.droppedByCap > 0) this.telemetry.failOpen("part_cap", budget.droppedByCap);
    if (budget.droppedByDeadline > 0) this.telemetry.failOpen("deadline", budget.droppedByDeadline);
    if (budget.failedParts > 0) this.telemetry.failOpen("part_store", budget.failedParts);
    this.logger.warn(
      {
        projectId: data.tenantId,
        traceId: data.span.traceId,
        spanId: data.span.spanId,
        extractedParts: refs.length,
        droppedByCap: budget.droppedByCap,
        droppedByDeadline: budget.droppedByDeadline,
        failedParts: budget.failedParts,
      },
      "span media extraction hit its budget — remaining parts stay inline",
    );
  }
}
