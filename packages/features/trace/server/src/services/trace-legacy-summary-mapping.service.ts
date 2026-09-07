import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  addOtelLogRecordCountAlias,
  createError,
  FALLBACK_ATTRIBUTE_MAPPINGS,
  parseComputedInput,
  parseComputedOutput,
  RESERVED_ATTRIBUTE_MAPPINGS,
  tokenMetricsFromAttributes,
  tryParseJsonArray,
} from "../rules/legacy-summary-attributes.rules.ts";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { Event, Span, Trace, TraceMetadata } from "@langwatch/trace-contract";

export class TraceLegacySummaryMappingService {
  static create(): TraceLegacySummaryMappingService {
    return new TraceLegacySummaryMappingService();
  }

  /**
   * Maps `TraceSummaryData.attributes` to the legacy TraceMetadata format. The ClickHouse
   * attributes map stores metadata under semantic-convention keys, which have to be mapped onto
   * the flat TraceMetadata structure.
   */
  static mapAttributesToMetadata(
    attributes: Record<string, string>,
    topicId: string | null,
    subTopicId: string | null,
  ): TraceMetadata {
    const metadata: TraceMetadata = {};
    // Reserved fields first, last-wins within that set; a fallback key only fills a field the
    // reserved pass left empty.
    for (const [attrKey, metadataKey] of Object.entries(RESERVED_ATTRIBUTE_MAPPINGS)) {
      const value = attributes[attrKey];
      if (value !== void 0) {
        metadata[metadataKey] = value;
      }
    }

    for (const [attrKey, metadataKey] of Object.entries(FALLBACK_ATTRIBUTE_MAPPINGS)) {
      const value = attributes[attrKey];
      if (value !== void 0 && metadata[metadataKey] === undefined) {
        metadata[metadataKey] = value;
      }
    }

    if (topicId) {
      metadata.topic_id = topicId;
    }

    if (subTopicId) {
      metadata.subtopic_id = subTopicId;
    }

    const parsedArrayKeys = TraceLegacySummaryMappingService.assignArrayMetadata({
      metadata,
      attributes,
    });
    TraceLegacySummaryMappingService.assignCustomMetadata({
      metadata,
      attributes,
      parsedArrayKeys,
    });
    addOtelLogRecordCountAlias(metadata, attributes);

    return metadata;
  }

  /**
   * The metadata fields the fold stamps as JSON array strings, surfaced as real arrays. A labels
   * value that is not valid JSON is one label; a models value that is not a JSON array is not ours
   * at all, and stays reachable through the generic passthrough with its original string.
   */
  private static assignArrayMetadata({
    metadata,
    attributes,
  }: {
    metadata: TraceMetadata;
    attributes: Record<string, string>;
  }): Set<string> {
    const parsedArrayKeys = new Set<string>();
    const labelsStr = attributes["langwatch.labels"] ?? attributes.labels;
    if (labelsStr) {
      const labels = tryParseJsonArray(labelsStr);
      metadata.labels = labels ?? [labelsStr];
    }

    const promptIds = tryParseJsonArray(attributes["langwatch.prompt_ids"]);
    if (promptIds) {
      metadata.prompt_ids = promptIds;
    }

    const models = tryParseJsonArray(attributes["metadata.models"]);
    if (models) {
      metadata.models = models;
      parsedArrayKeys.add("metadata.models");
    }

    return parsedArrayKeys;
  }

  /**
   * Every attribute the mapped fields did not claim, as custom metadata. The internal `metadata.`
   * prefix is stripped so the API answers with bare keys.
   */
  private static assignCustomMetadata({
    metadata,
    attributes,
    parsedArrayKeys,
  }: {
    metadata: TraceMetadata;
    attributes: Record<string, string>;
    parsedArrayKeys: Set<string>;
  }): void {
    const knownKeys = new Set([
      ...Object.keys(RESERVED_ATTRIBUTE_MAPPINGS),
      ...Object.keys(FALLBACK_ATTRIBUTE_MAPPINGS),
      "langwatch.labels",
      "labels",
      "langwatch.prompt_ids",
      "langwatch.prompt_version_ids",
      // Fold-internal bookkeeping for the metadata.model stamp; not user metadata.
      "langwatch.reserved.model_metadata_stamped",
      ...parsedArrayKeys,
    ]);

    for (const [key, value] of Object.entries(attributes)) {
      if (knownKeys.has(key)) {
        continue;
      }

      const bareKey = key.startsWith("metadata.") ? key.slice("metadata.".length) : key;
      if (bareKey && metadata[bareKey] === undefined) {
        metadata[bareKey] = value;
      }
    }
  }

  /** The finite numbers under `event.metrics`, keyed as they arrived. */
  static #eventMetrics(rawMetrics: unknown): Record<string, number> {
    const metrics: Record<string, number> = {};
    if (typeof rawMetrics !== "object" || rawMetrics === null) {
      return metrics;
    }

    for (const [key, value] of Object.entries(rawMetrics as Record<string, unknown>)) {
      const num = Number(value);
      if (Number.isFinite(num)) {
        metrics[key] = num;
      }
    }

    return metrics;
  }

  /** The string values under `event.details`, keyed as they arrived. */
  static #eventDetails(rawDetails: unknown): Record<string, string> {
    const details: Record<string, string> = {};
    if (typeof rawDetails !== "object" || rawDetails === null) {
      return details;
    }

    for (const [key, value] of Object.entries(rawDetails as Record<string, unknown>)) {
      if (typeof value === "string") {
        details[key] = value;
      }
    }

    return details;
  }

  /** One span's event, or none when the span carries no typed `event` object. */
  static #eventOfSpan({
    span,
    projectId,
    traceId,
  }: {
    span: Span;
    projectId: string;
    traceId: string;
  }): Event | null {
    const eventObj = span.params?.event;
    if (typeof eventObj !== "object" || eventObj === null) {
      return null;
    }

    const eventRecord = eventObj as Record<string, unknown>;
    const eventType = eventRecord.type;
    if (typeof eventType !== "string" || !eventType) {
      return null;
    }

    return {
      event_id: span.span_id,
      event_type: eventType,
      project_id: projectId,
      metrics: TraceLegacySummaryMappingService.#eventMetrics(eventRecord.metrics),
      event_details: TraceLegacySummaryMappingService.#eventDetails(eventRecord.details),
      trace_id: traceId,
      timestamps: {
        started_at: span.timestamps.started_at,
        inserted_at: span.timestamps.started_at,
        updated_at: span.timestamps.finished_at,
      },
    };
  }

  /**
   * Extracts Event objects from spans that have event.type in their attributes.
   * Events are stored in ClickHouse as spans with event.* span attributes.
   * After unflattening, these appear as params.event.type, params.event.metrics.*, etc.
   */
  static extractEventsFromSpans({
    spans,
    projectId,
    traceId,
  }: {
    spans: Span[];
    projectId: string;
    traceId: string;
  }): Event[] {
    const events: Event[] = [];

    for (const span of spans) {
      const event = TraceLegacySummaryMappingService.#eventOfSpan({ span, projectId, traceId });
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Maps a TraceSummaryData (from ClickHouse trace_summaries) and its associated spans
   * to the legacy Trace type used by the pre-ClickHouse trace system.
   */
  static mapTraceSummaryToTrace(
    summary: TraceSummaryData,
    spans: Span[],
    projectId: string,
    traceCanonicalisation: TraceCanonicalisationService,
  ): Trace {
    const metadata = TraceLegacySummaryMappingService.mapAttributesToMetadata(
      summary.attributes,
      summary.topicId,
      summary.subTopicId,
    );

    const events = TraceLegacySummaryMappingService.extractEventsFromSpans({
      spans,
      projectId,
      traceId: summary.traceId,
    });

    const trace: Trace = {
      trace_id: summary.traceId,
      project_id: projectId,
      metadata,
      timestamps: {
        // The span timing baseline where the trace has one, otherwise the storage
        // anchor (ADR-087). A trace whose only signal is a log record has no span
        // start to report; before the anchor existed it reported the epoch, which
        // rendered as 1970 in the drawer and the list. The anchor is the time that
        // trace's first signal was accepted, which is the honest answer.
        started_at: summary.occurredAt > 0 ? summary.occurredAt : (summary.storageAnchorMs ?? 0),
        inserted_at: summary.createdAt,
        updated_at: summary.updatedAt,
      },
      input: parseComputedInput(summary.computedInput, summary.attributes, traceCanonicalisation),
      output: parseComputedOutput(
        summary.computedOutput,
        summary.attributes,
        traceCanonicalisation,
      ),
      metrics: {
        first_token_ms: summary.timeToFirstTokenMs,
        total_time_ms: summary.totalDurationMs,
        prompt_tokens: summary.totalPromptTokenCount,
        completion_tokens: summary.totalCompletionTokenCount,
        total_cost: summary.totalCost,
        tokens_estimated: summary.tokensEstimated,
        ...tokenMetricsFromAttributes(summary.attributes),
      },
      error: createError(summary.containsErrorStatus, summary.errorMessage),
      events: events.length > 0 ? events : undefined,
      spans,
    };

    return trace;
  }
}
