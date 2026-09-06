/**
 * Edge media extraction, run after span normalization and before the ADR-022 size check:
 * externalizing the heavy part first usually brings the payload under the inline threshold. It is
 * fail-open, and skipped for projects whose data-privacy policy drops span content.
 */

import { TraceValueMediaExtractionService } from "./trace-value-media-extraction.service.ts";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { containsMediaMarkers, type OtlpKeyValue, type OtlpSpan } from "@langwatch/trace-contract";
import type { TraceEdgeMediaTelemetryPort } from "../ports/trace-media-store.port.ts";
import type { TraceMediaStorePort } from "../ports/trace-media-store.port.ts";
import type { ExtractedRef } from "../rules/content-part-extraction.rules.ts";
import { type ExtractionBudget } from "./trace-value-media-extraction.service.ts";

/** Purpose tag for stored objects extracted from trace span content. */
export const TRACE_MEDIA_PURPOSE = "trace_content";

/** Structured logger surface used by the extraction hook. */
export interface EdgeMediaExtractionLogger {
  info(context: Record<string, unknown>, msg: string): void;
  warn(context: Record<string, unknown>, msg: string): void;
}

/** Injectable policy and storage dependencies for the extraction hook. */
export interface EdgeMediaExtractionDeps {
  featureFlags: FeatureFlagService;
  /**
   * True when the project's resolved data-privacy policy drops any span content. Required rather
   * than defaulted: a default of `false` would store media at the edge for exactly the projects
   * whose policy is about to discard it, defeating this interlock.
   */
  hasContentDropRules: (projectId: string) => Promise<boolean>;
  /** The fail-open counters this hook reports; absent means unreported. */
  telemetry?: TraceEdgeMediaTelemetryPort;
  /** Process-composed stored-objects capability for production ingestion. */
  service?: TraceMediaStorePort;
  /** Compatibility seam retained for focused tests that build local storage. */
  createService?: (projectId: string) => TraceMediaStorePort;
}

async function rewriteAttributeList({
  attributes,
  projectId,
  ownerId,
  service,
  refs,
  budget,
}: {
  attributes: OtlpKeyValue[];
  projectId: string;
  ownerId: string;
  service: TraceMediaStorePort;
  refs: ExtractedRef[];
  budget: ExtractionBudget;
}): Promise<OtlpKeyValue[]> {
  let changed = false;
  const out: OtlpKeyValue[] = [];
  for (const attr of attributes) {
    const stringValue = attr?.value?.stringValue;
    if (typeof stringValue === "string" && containsMediaMarkers(stringValue)) {
      const result = await TraceValueMediaExtractionService.extractInlineMediaFromValue({
        value: stringValue,
        projectId,
        purpose: TRACE_MEDIA_PURPOSE,
        ownerKind: "trace",
        ownerId,
        service,
        budget,
      });
      if (typeof result.value === "string" && result.value !== stringValue) {
        changed = true;
        refs.push(...result.refs);
        out.push({
          ...attr,
          value: { ...attr.value, stringValue: result.value },
        });
        continue;
      }
    }

    out.push(attr);
  }

  return changed ? out : attributes;
}

export class TraceEdgeMediaExtractionService {
  static create(): TraceEdgeMediaExtractionService {
    return new TraceEdgeMediaExtractionService();
  }

  /**
   * True when any span or span-event attribute string value carries a media
   * marker. Pure linear scans, no allocation, no I/O — this is the gate that
   * keeps the 99.9% no-media ingestion path at zero added cost.
   */
  static spanCarriesMediaMarkers(span: OtlpSpan): boolean {
    const attrsCarryMarkers = (attributes: OtlpKeyValue[] | undefined) =>
      Array.isArray(attributes) &&
      attributes.some(
        (attr) =>
          typeof attr?.value?.stringValue === "string" &&
          containsMediaMarkers(attr.value.stringValue),
      );

    if (attrsCarryMarkers(span.attributes)) {
      return true;
    }

    for (const event of span.events ?? []) {
      if (attrsCarryMarkers(event.attributes)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Externalizes inline media from the span's attribute values, returning rewritten command data
   * with stored-object references — or the original data unchanged when there is no media, the
   * flag is off, the project has content-drop rules, or anything fails.
   */
  static async maybeExtractSpanMedia({
    data,
    deps,
    logger,
  }: {
    data: RecordSpanCommandData;
    deps: EdgeMediaExtractionDeps;
    logger: EdgeMediaExtractionLogger;
  }): Promise<RecordSpanCommandData> {
    const span = data.span;
    if (!TraceEdgeMediaExtractionService.spanCarriesMediaMarkers(span)) {
      return data;
    }

    const projectId = data.tenantId;
    let stage: "flag_store" | "privacy_probe" | "storage" = "flag_store";
    try {
      const enabled = await deps.featureFlags.isEnabled("release_trace_media_extraction", {
        kind: "project",
        projectId,
      });
      if (!enabled) {
        return data;
      }

      stage = "privacy_probe";
      if (await deps.hasContentDropRules(projectId)) {
        return data;
      }

      stage = "storage";
      const service = deps.service ?? deps.createService?.(projectId);
      if (!service) {
        return data;
      }

      return await TraceEdgeMediaExtractionService.externaliseSpanMedia({
        data,
        service,
        deps,
        logger,
      });
    } catch (err) {
      deps.telemetry?.failOpen(stage);
      logger.warn(
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

  /**
   * The span with its inline media externalized, or the original command data when nothing moved.
   * One budget covers the whole span, so a span cannot multiply the cost by spreading media over
   * many attributes.
   */
  private static async externaliseSpanMedia({
    data,
    service,
    deps,
    logger,
  }: {
    data: RecordSpanCommandData;
    service: TraceMediaStorePort;
    deps: EdgeMediaExtractionDeps;
    logger: EdgeMediaExtractionLogger;
  }): Promise<RecordSpanCommandData> {
    const span = data.span;
    const projectId = data.tenantId;
    const refs: ExtractedRef[] = [];
    const budget = TraceValueMediaExtractionService.createExtractionBudget();
    const attributes = await rewriteAttributeList({
      attributes: span.attributes,
      projectId,
      ownerId: span.traceId,
      service,
      refs,
      budget,
    });

    let eventsChanged = false;
    const events = [...(span.events ?? [])];
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const rewritten = await rewriteAttributeList({
        attributes: event.attributes,
        projectId,
        ownerId: span.traceId,
        service,
        refs,
        budget,
      });
      if (rewritten !== event.attributes) {
        eventsChanged = true;
        events[i] = { ...event, attributes: rewritten };
      }
    }

    TraceEdgeMediaExtractionService.reportBudgetDrops({ budget, refs, data, deps, logger });
    if (attributes === span.attributes && !eventsChanged) {
      return data;
    }

    logger.info(
      {
        projectId,
        traceId: span.traceId,
        spanId: span.spanId,
        storedObjectIds: refs.map((ref) => ref.id),
        dedupHits: refs.filter((ref) => ref.isDuplicate).length,
      },
      `span media extraction externalized ${refs.length} stored object(s)`,
    );

    return {
      ...data,
      span: { ...span, attributes, ...(eventsChanged ? { events } : {}) },
    };
  }

  /**
   * Budget drops are fail-open per part but never silent: the affected parts ride through inline
   * and each reason is counted and logged, so a sustained rate is alertable.
   */
  private static reportBudgetDrops({
    budget,
    refs,
    data,
    deps,
    logger,
  }: {
    budget: ExtractionBudget;
    refs: ExtractedRef[];
    data: RecordSpanCommandData;
    deps: EdgeMediaExtractionDeps;
    logger: EdgeMediaExtractionLogger;
  }): void {
    if (budget.droppedByCap === 0 && budget.droppedByDeadline === 0 && budget.failedParts === 0) {
      return;
    }

    if (budget.droppedByCap > 0) {
      deps.telemetry?.failOpen("part_cap", budget.droppedByCap);
    }

    if (budget.droppedByDeadline > 0) {
      deps.telemetry?.failOpen("deadline", budget.droppedByDeadline);
    }

    if (budget.failedParts > 0) {
      deps.telemetry?.failOpen("part_store", budget.failedParts);
    }

    logger.warn(
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
