import type { Event } from "~/server/event-sourcing/domain/types.js";
import type { TraceSummaryData } from "~/server/app-layer/traces/types.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type { SpanAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.store.js";
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
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants.js";
import { TraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection.js";
import { SpanStorageMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.mapProjection.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import type {
  ElasticSearchTrace,
  ElasticSearchSpan,
  ElasticSearchEvent,
} from "~/server/tracer/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";
import { esSpanToOtlp, esEventToOtlpEvent } from "./esSpanToOtlp.js";

type EsTraceDoc = ElasticSearchTrace & EsHit;

interface TraceMigrationDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  spanAppendStore: SpanAppendStore;
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
  const foldProjection = new TraceSummaryFoldProjection({
    store: noopStore as any,
  });
  const mapProjection = new SpanStorageMapProjection({
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

      // 2. Attach ES trace-level events to the first span
      // ES events (thumbs_up_down, add_to_cart, etc.) are trace-scoped and have
      // no span_id. In OTLP, events belong to spans, so we attach them to the
      // first span. If there are no spans, we skip them.
      const esEvents = doc.events ?? [];
      if (esEvents.length > 0 && allEvents.length > 0) {
        const firstSpanEvent = allEvents[0]! as SpanReceivedEvent;
        const firstOtlpSpan = firstSpanEvent.data.span;
        for (const esEvent of esEvents) {
          firstOtlpSpan.events.push(
            esEventToOtlpEvent(esEvent as ElasticSearchEvent),
          );
        }
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

      // SpanStorage append writes — bulk insert all spans for a trace at once
      if (normalizedSpans.length > 0) {
        projectionWrites.push(() =>
          deps.spanAppendStore.bulkAppend(normalizedSpans, storeContext),
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
