/**
 * The span path of edge media extraction: markers, then the flag, then the privacy probe, then
 * the walk over attributes and events under one budget. Fail-open throughout.
 */

import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { type OtlpKeyValue, type OtlpSpan } from "@langwatch/otlp/trace-request";
import {
  type RecordSpanCommandData,
  containsMediaMarkers,
  storableSpanTimesOf,
} from "@langwatch/trace-contract";

import type { TraceEdgeMediaTelemetry } from "./trace-edge-media-telemetry.service.ts";
import type {
  ExtractedRef,
  ExtractionBudget,
  TraceMediaExtractionService,
} from "./trace-media-extraction.service.ts";

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

export class TraceSpanMediaExtractionService {
  static create({
    extraction,
    telemetry,
    logger,
  }: {
    extraction: TraceMediaExtractionService;
    telemetry: TraceEdgeMediaTelemetry;
    logger: EdgeMediaExtractionLogger;
  }): TraceSpanMediaExtractionService {
    return new TraceSpanMediaExtractionService(extraction, telemetry, logger);
  }

  private constructor(
    private readonly extraction: TraceMediaExtractionService,
    private readonly telemetry: TraceEdgeMediaTelemetry,
    private readonly logger: EdgeMediaExtractionLogger,
  ) {}

  /** True when any span or span-event attribute string carries a media marker. No I/O. */
  spanCarriesMediaMarkers(span: OtlpSpan): boolean {
    if (attributesCarryMarkers(span.attributes)) return true;

    return (span.events ?? []).some((event) => attributesCarryMarkers(event.attributes));
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

  /** One budget covers the whole span, so spreading media over attributes cannot multiply cost. */
  private async externaliseSpanMedia(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const span = data.span;
    const projectId = data.tenantId;
    const refs: ExtractedRef[] = [];
    const budget = this.extraction.createExtractionBudget();
    // Trace rows expire from the span's start, so its media is retained from there too.
    const times = storableSpanTimesOf(span);
    const retainFromMs = "times" in times ? times.times.startTimeUnixMs : undefined;
    const walk = { projectId, ownerId: span.traceId, retainFromMs, refs, budget };
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
    retainFromMs,
    refs,
    budget,
  }: {
    attributes: OtlpKeyValue[];
    projectId: string;
    ownerId: string;
    retainFromMs: number | undefined;
    refs: ExtractedRef[];
    budget: ExtractionBudget;
  }): Promise<OtlpKeyValue[]> {
    let changed = false;
    const out: OtlpKeyValue[] = [];
    for (const attr of attributes) {
      const stringValue = attr?.value?.stringValue;
      if (typeof stringValue === "string" && containsMediaMarkers(stringValue)) {
        const result = await this.extraction.extractFromValue({
          value: stringValue,
          projectId,
          ownerId,
          retainFromMs,
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
