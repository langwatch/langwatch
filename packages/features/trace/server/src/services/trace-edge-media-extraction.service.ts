/**
 * Edge media extraction (`maybeExtractSpanMedia`), run in the processCommandData hook after span normalization and BEFORE the ADR-022 `maybeSpool` size check: externalizing the heavy media part first usually brings the payload back under COMMAND_INLINE_THRESHOLD, replacing a transient whole-payload spool with one permanent, deduplicated, idempotent PUT. Fail-open throughout — any failing stage falls back to unmodified command data with a warn log; any project whose data-privacy policy drops span content skips extraction entirely, since persisting bytes here for content the policy later discards would defeat that policy.
 */

import { TraceValueMediaExtractionService } from "./trace-value-media-extraction.service";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { containsMediaMarkers, type OtlpKeyValue, type OtlpSpan } from "@langwatch/trace-contract";
import type { TraceEdgeMediaTelemetryPort } from "../ports/trace-media-store.port";
import type { TraceMediaStorePort } from "../ports/trace-media-store.port";
import type { ExtractedRef } from "./trace-content-extraction.service";
import { type ExtractionBudget } from "./trace-value-media-extraction.service";

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
   * True when the project's resolved data-privacy policy drops any span content. REQUIRED rather than defaulted — a default of `false` would store media at the edge for exactly the projects whose policy is about to discard it, defeating this interlock.
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
   * Externalizes inline media from the span's attribute values, returning rewritten command data with stored-object references — or the original data unchanged when there is no media, the flag is off, the project has content-drop rules, or anything fails (fail-open).
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

    const resolved = {
      featureFlags: deps.featureFlags,
      hasContentDropRules: deps.hasContentDropRules,
      service: deps.service,
      createService: deps.createService,
    };

    const projectId = data.tenantId;
    const traceId = span.traceId;
    const spanId = span.spanId;

    let stage: "flag_store" | "privacy_probe" | "storage" = "flag_store";
    try {
      const enabled = await resolved.featureFlags.isEnabled("release_trace_media_extraction", {
        kind: "project",
        projectId,
      });
      if (!enabled) {
        return data;
      }

      stage = "privacy_probe";
      if (await resolved.hasContentDropRules(projectId)) {
        return data;
      }

      stage = "storage";
      const service = resolved.service ?? resolved.createService?.(projectId);
      if (!service) {
        return data;
      }

      const refs: ExtractedRef[] = [];
      // One budget for the WHOLE span: the part cap and the deadline apply
      // across every attribute and event-attribute value, so a span cannot
      // multiply the cost by spreading media over many attributes.
      const budget = TraceValueMediaExtractionService.createExtractionBudget();

      const attributes = await rewriteAttributeList({
        attributes: span.attributes,
        projectId,
        ownerId: traceId,
        service,
        refs,
        budget,
      });

      let eventsChanged = false;
      const events = (span.events ?? []).map((event) => event);
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        const rewritten = await rewriteAttributeList({
          attributes: event.attributes,
          projectId,
          ownerId: traceId,
          service,
          refs,
          budget,
        });
        if (rewritten !== event.attributes) {
          eventsChanged = true;
          events[i] = { ...event, attributes: rewritten };
        }
      }

      // Budget drops are fail-open per part, never silent: the affected parts
      // ride through inline (today's behavior) and the drop is logged and
      // counted so a sustained rate is alertable.
      if (budget.droppedByCap > 0 || budget.droppedByDeadline > 0 || budget.failedParts > 0) {
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
            projectId,
            traceId,
            spanId,
            extractedParts: refs.length,
            droppedByCap: budget.droppedByCap,
            droppedByDeadline: budget.droppedByDeadline,
            failedParts: budget.failedParts,
          },
          "span media extraction hit its budget — remaining parts stay inline",
        );
      }

      if (attributes === span.attributes && !eventsChanged) {
        return data;
      }

      logger.info(
        {
          projectId,
          traceId,
          spanId,
          storedObjectIds: refs.map((ref) => ref.id),
          dedupHits: refs.filter((ref) => ref.isDuplicate).length,
        },
        `span media extraction externalized ${refs.length} stored object(s)`,
      );

      return {
        ...data,
        span: {
          ...span,
          attributes,
          ...(eventsChanged ? { events } : {}),
        },
      };
    } catch (err) {
      deps.telemetry?.failOpen(stage);
      logger.warn(
        {
          projectId,
          traceId,
          spanId,
          reason: stage,
          error: err instanceof Error ? err.message : String(err),
        },
        "Edge media extraction failed — falling back to unmodified command data (fail-open)",
      );

      return data;
    }
  }
}
