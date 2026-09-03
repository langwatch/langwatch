/**
 * Edge media extraction for trace spans.
 *
 * `maybeExtractSpanMedia` runs inside the processCommandData edge hook
 * (TraceRequestCollectionService), after the span is normalized and BEFORE
 * the ADR-022 `maybeSpool` size check. It walks the span's attribute values
 * (and span-event attribute values) for inline media parts — base64 audio
 * turns, data-URI images, file attachments — and externalizes their bytes to
 * the content-addressed stored-objects store, rewriting each part to a
 * lightweight `/api/files/{projectId}/{id}` reference.
 *
 * Ordering rationale: extracting the heavy media part FIRST usually brings
 * the remaining payload back under COMMAND_INLINE_THRESHOLD, so the
 * transient whole-payload spool (PUT + GET + DELETE) is replaced by a single
 * permanent, deduplicated PUT. A scenario run's recording and the same
 * recording observed on its trace hash to the same stored object — stored
 * once, referenced from both.
 *
 * Receiving guarantee: the whole function is fail-open. The cheap media
 * marker gate keeps the no-media hot path free of any I/O; every stage that
 * can fail (flag store, data-privacy probe, object store) falls back to the
 * unmodified command data with a warn log and a fail-open counter, so
 * ingestion is never blocked and the worst case is today's inline behavior.
 * Content-addressed PUTs are idempotent, so SDK retries and queue re-stages
 * never double-store.
 *
 * Privacy interlock: the data-privacy content drop runs later, at the
 * RecordSpanCommand choke point. Persisting media bytes at the edge for a
 * project whose policy then drops that content would retain what the policy
 * discards — so any project with drop rules skips extraction entirely and
 * keeps today's behavior end to end.
 */

import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { containsMediaMarkers, type OtlpKeyValue, type OtlpSpan } from "@langwatch/trace-contract";
import type { TraceEdgeMediaTelemetryPort } from "../ports/trace-media-store.port";
import type { TraceMediaStorePort } from "../ports/trace-media-store.port";
import type { ExtractedRef } from "./trace-content-extraction.service";
import {
  createExtractionBudget,
  type ExtractionBudget,
  extractInlineMediaFromValue,
} from "./trace-value-media-extraction.service";

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
   * True when the project's resolved data-privacy policy drops any span
   * content. REQUIRED rather than defaulted: a default that answered `false`
   * would store media at the edge for exactly the projects whose policy is
   * about to discard that content, which is the interlock this hook exists to
   * honour.
   */
  hasContentDropRules: (projectId: string) => Promise<boolean>;
  /** The fail-open counters this hook reports; absent means unreported. */
  telemetry?: TraceEdgeMediaTelemetryPort;
  /** Process-composed stored-objects capability for production ingestion. */
  service?: TraceMediaStorePort;
  /** Compatibility seam retained for focused tests that build local storage. */
  createService?: (projectId: string) => TraceMediaStorePort;
}

/**
 * True when any span or span-event attribute string value carries a media
 * marker. Pure linear scans, no allocation, no I/O — this is the gate that
 * keeps the 99.9% no-media ingestion path at zero added cost.
 */
export function spanCarriesMediaMarkers(span: OtlpSpan): boolean {
  const attrsCarryMarkers = (attributes: OtlpKeyValue[] | undefined) =>
    Array.isArray(attributes) &&
    attributes.some(
      (attr) =>
        typeof attr?.value?.stringValue === "string" &&
        containsMediaMarkers(attr.value.stringValue),
    );

  if (attrsCarryMarkers(span.attributes)) return true;
  for (const event of span.events ?? []) {
    if (attrsCarryMarkers(event.attributes)) return true;
  }
  return false;
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
      const result = await extractInlineMediaFromValue({
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

/**
 * Externalizes inline media from the span's attribute values, returning the
 * command data with parts rewritten to stored-object references — or the
 * original command data unchanged when there is no media, the flag is off,
 * the project has content-drop rules, or anything fails (fail-open).
 */
export async function maybeExtractSpanMedia({
  data,
  deps,
  logger,
}: {
  data: RecordSpanCommandData;
  deps: EdgeMediaExtractionDeps;
  logger: EdgeMediaExtractionLogger;
}): Promise<RecordSpanCommandData> {
  const span = data.span;
  if (!spanCarriesMediaMarkers(span)) return data;

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
    if (!enabled) return data;

    stage = "privacy_probe";
    if (await resolved.hasContentDropRules(projectId)) return data;

    stage = "storage";
    const service = resolved.service ?? resolved.createService?.(projectId);
    if (!service) return data;
    const refs: ExtractedRef[] = [];
    // One budget for the WHOLE span: the part cap and the deadline apply
    // across every attribute and event-attribute value, so a span cannot
    // multiply the cost by spreading media over many attributes.
    const budget = createExtractionBudget();

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
      if (budget.droppedByCap > 0) deps.telemetry?.failOpen("part_cap", budget.droppedByCap);
      if (budget.droppedByDeadline > 0)
        deps.telemetry?.failOpen("deadline", budget.droppedByDeadline);
      if (budget.failedParts > 0) deps.telemetry?.failOpen("part_store", budget.failedParts);
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

    if (attributes === span.attributes && !eventsChanged) return data;

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
