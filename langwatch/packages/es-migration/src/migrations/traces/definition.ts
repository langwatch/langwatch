import type { Event } from "~/server/event-sourcing/domain/types.js";
import type { TraceSummaryData } from "~/server/app-layer/traces/types.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types.js";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans.js";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/events.js";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
  SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE,
  SATISFACTION_SCORE_ASSIGNED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants.js";
import { createTraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection.js";
import { createSpanStorageMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.mapProjection.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import type {
  ElasticSearchTrace,
  ElasticSearchSpan,
  ElasticSearchEvent,
} from "~/server/tracer/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";
import { esSpanToOtlp, esEventToOtlpSpan } from "./esSpanToOtlp.js";

type EsTraceDoc = ElasticSearchTrace & EsHit;

interface TraceMigrationDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  spanAppendStore: AppendStore<NormalizedSpan>;
}

export function createTraceMigrationDefinition(
  deps: TraceMigrationDeps,
): MigrationDefinition<EsTraceDoc> {
  const noopStore = {
    get: async () => null,
    store: async () => {},
  };
  const noopAppendStore = { append: async () => {} };

  // Create projection definitions to reuse their pure init/apply/map functions
  const foldProjection = createTraceSummaryFoldProjection({
    store: noopStore as any,
  });
  const mapProjection = createSpanStorageMapProjection({
    store: noopAppendStore as any,
  });

  return {
    name: "traces",
    esIndex: "search-traces-alias",
    esQuery: { exists: { field: "trace_id" } },
    esSort: [{ "timestamps.started_at": "asc" }, { trace_id: "asc" }],
    aggregateType: "trace",
    timestampField: "timestamps.started_at",
    statsField: "timestamps.started_at",

    getTenantAggregates(events: EsHit[]): Map<string, Set<string>> {
      const map = new Map<string, Set<string>>();
      for (const raw of events) {
        const doc = raw as unknown as EsTraceDoc;
        const tenantId = doc.project_id;
        const traceId = doc.trace_id;
        let ids = map.get(tenantId);
        if (!ids) {
          ids = new Set();
          map.set(tenantId, ids);
        }
        ids.add(traceId);
      }
      return map;
    },

    aggregate(events: EsHit[]): Map<string, EsTraceDoc> {
      const aggregates = new Map<string, EsTraceDoc>();
      for (const raw of events) {
        const doc = raw as unknown as EsTraceDoc;
        // Key must include tenant to prevent cross-tenant collisions on trace_id
        aggregates.set(`${doc.project_id}:${doc.trace_id}`, doc);
      }
      return aggregates;
    },

    buildCommands() {
      // Not used — processAggregate is used instead
      return [];
    },

    processAggregate(doc: EsTraceDoc, aggregateId: string): DirectWriteResult {
      const tenantId = doc.project_id;
      const traceId = doc.trace_id;
      const occurredAt = doc.timestamps.started_at;

      // Reconstruct OTLP resource from ES metadata.custom
      const customMetadata = (doc.metadata as any)?.custom as Record<string, string> | undefined;
      const resource = customMetadata && Object.keys(customMetadata).length > 0
        ? {
            attributes: Object.entries(customMetadata).map(([key, value]) => ({
              key,
              value: { stringValue: String(value) },
            })),
          }
        : null;

      const allEvents: Event[] = [];

      // 1. Convert ES spans → SpanReceivedEvents
      const esSpans = doc.spans ?? [];
      for (const esSpan of esSpans) {
        const otlpSpan = esSpanToOtlp(esSpan as ElasticSearchSpan, traceId);
        const event = EventUtils.createEvent<SpanReceivedEvent>({
          aggregateType: "trace" as any,
          aggregateId: traceId,
          tenantId: tenantId as any,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            span: otlpSpan,
            resource,
            instrumentationScope: null,
            piiRedactionLevel: "DISABLED",
          },
          metadata: {
            spanId: esSpan.span_id,
            traceId,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${traceId}:${esSpan.span_id}`,
        });
        allEvents.push(event);
      }

      // 2. Convert ES events → SpanReceivedEvents (as OTLP spans)
      const esEvents = doc.events ?? [];
      for (const esEvent of esEvents) {
        const otlpSpan = esEventToOtlpSpan(esEvent as ElasticSearchEvent, traceId);
        const event = EventUtils.createEvent<SpanReceivedEvent>({
          aggregateType: "trace" as any,
          aggregateId: traceId,
          tenantId: tenantId as any,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            span: otlpSpan,
            resource,
            instrumentationScope: null,
            piiRedactionLevel: "DISABLED",
          },
          metadata: {
            spanId: (esEvent as ElasticSearchEvent).event_id,
            traceId,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${traceId}:${(esEvent as ElasticSearchEvent).event_id}`,
        });
        allEvents.push(event);
      }

      // 3. Topic assignment event (if present in metadata)
      if (doc.metadata?.topic_id) {
        const topicEvent = EventUtils.createEvent({
          aggregateType: "trace" as any,
          aggregateId: traceId,
          tenantId: tenantId as any,
          type: TOPIC_ASSIGNED_EVENT_TYPE,
          version: TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
          data: {
            topicId: doc.metadata.topic_id ?? null,
            topicName: null,
            subtopicId: doc.metadata.subtopic_id ?? null,
            subtopicName: null,
            isIncremental: false,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${traceId}:topic`,
        });
        allEvents.push(topicEvent);
      }

      // 4. Satisfaction score event (if present in input)
      if (doc.input?.satisfaction_score != null) {
        const satisfactionEvent = EventUtils.createEvent({
          aggregateType: "trace" as any,
          aggregateId: traceId,
          tenantId: tenantId as any,
          type: SATISFACTION_SCORE_ASSIGNED_EVENT_TYPE,
          version: SATISFACTION_SCORE_ASSIGNED_EVENT_VERSION_LATEST,
          data: {
            satisfactionScore: doc.input.satisfaction_score,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${traceId}:satisfaction`,
        });
        allEvents.push(satisfactionEvent);
      }

      // Compute fold projection (TraceSummary) in memory
      let traceSummaryState = foldProjection.init();
      traceSummaryState = {
        ...traceSummaryState,
        createdAt: occurredAt,
      };
      for (const event of allEvents) {
        traceSummaryState = foldProjection.apply(
          traceSummaryState,
          event as TraceProcessingEvent,
        );
      }

      // Compute map projection (NormalizedSpan) for each SpanReceivedEvent
      const normalizedSpans: NormalizedSpan[] = [];
      for (const event of allEvents) {
        if (event.type === SPAN_RECEIVED_EVENT_TYPE) {
          const span = mapProjection.map(event as SpanReceivedEvent);
          if (span) {
            normalizedSpans.push(span);
          }
        }
      }

      // Convert domain events to event records
      const eventRecords = allEvents.map(eventToRecord);

      // Build projection write closures
      const storeContext = { aggregateId: traceId, tenantId: tenantId as any };

      const projectionWrites: Array<() => Promise<void>> = [];

      // TraceSummary fold store write
      if (traceSummaryState.spanCount > 0) {
        projectionWrites.push(() =>
          deps.traceSummaryStore.store(traceSummaryState, storeContext),
        );
      }

      // SpanStorage append writes
      for (const span of normalizedSpans) {
        projectionWrites.push(() =>
          deps.spanAppendStore.append(span, storeContext),
        );
      }

      return {
        eventRecords,
        projectionWrites,
        commandCount: allEvents.length,
        projectionState: traceSummaryState,
      };
    },
  };
}
