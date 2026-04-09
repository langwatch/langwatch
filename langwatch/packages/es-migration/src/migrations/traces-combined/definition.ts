import type { Event } from "~/server/event-sourcing/domain/types.js";
import type { TraceSummaryData } from "~/server/app-layer/traces/types.js";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type { SpanAppendStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.store.js";
import type { EvaluationRunStore } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationRun.store.js";
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
import { createTraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection.js";
import { createSpanStorageMapProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/spanStorage.mapProjection.js";
import type {
  EvaluationReportedEvent,
  EvaluationProcessingEvent,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events.js";
import {
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants.js";
import { createEvaluationRunFoldProjection } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationRun.foldProjection.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import type {
  ElasticSearchTrace,
  ElasticSearchSpan,
  ElasticSearchEvent,
} from "~/server/tracer/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";
import { esSpanToOtlp, esEventToOtlpEvent } from "../traces/esSpanToOtlp.js";

type EsTraceDoc = ElasticSearchTrace & EsHit;

interface CombinedTraceMigrationDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  spanAppendStore: SpanAppendStore;
  evaluationRunStore: EvaluationRunStore;
}

export function createCombinedTraceMigrationDefinition(
  deps: CombinedTraceMigrationDeps,
): MigrationDefinition<EsTraceDoc> {
  const noopStore = {
    get: async () => null,
    store: async () => {},
  };
  const noopAppendStore = { append: async () => {} };

  // Trace projection definitions (reuse pure init/apply/map functions)
  const traceFoldProjection = createTraceSummaryFoldProjection({
    store: noopStore as any,
  });
  const spanMapProjection = createSpanStorageMapProjection({
    store: noopAppendStore as any,
  });

  // Evaluation projection definition
  const evalFoldProjection = createEvaluationRunFoldProjection({
    store: noopStore as any,
  });

  return {
    name: "traces-combined",
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
        aggregates.set(`${doc.project_id}:${doc.trace_id}`, doc);
      }
      return aggregates;
    },

    buildCommands() {
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

      const traceEvents: Event[] = [];

      // ── 1. Convert ES spans → SpanReceivedEvents ──
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
        traceEvents.push(event);
      }

      // ── 2. Attach ES trace-level events to the first span ──
      // ES events (thumbs_up_down, add_to_cart, etc.) are trace-scoped and have
      // no span_id. In OTLP, events belong to spans, so we attach them to the
      // first span. If there are no spans, we skip them.
      const esEvents = doc.events ?? [];
      if (esEvents.length > 0 && traceEvents.length > 0) {
        const firstSpanEvent = traceEvents[0]! as SpanReceivedEvent;
        const firstOtlpSpan = firstSpanEvent.data.span;
        for (const esEvent of esEvents) {
          firstOtlpSpan.events.push(
            esEventToOtlpEvent(esEvent as ElasticSearchEvent),
          );
        }
      }

      // ── 3. Topic assignment event ──
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
        traceEvents.push(topicEvent);
      }

      // ── 4. Compute trace fold projection (TraceSummary) ──
      let traceSummaryState = traceFoldProjection.init();
      traceSummaryState = {
        ...traceSummaryState,
        createdAt: occurredAt,
      };
      for (const event of traceEvents) {
        traceSummaryState = traceFoldProjection.apply(
          traceSummaryState,
          event as TraceProcessingEvent,
        );
      }

      // ── 5. Compute map projection (NormalizedSpan) ──
      const normalizedSpans: NormalizedSpan[] = [];
      for (const event of traceEvents) {
        if (event.type === SPAN_RECEIVED_EVENT_TYPE) {
          const span = spanMapProjection.map(event as SpanReceivedEvent);
          if (span) {
            normalizedSpans.push(span);
          }
        }
      }

      // ── 6. Process evaluations ──
      const evalEvents: Event[] = [];
      const evalBulkEntries: Array<{ state: EvaluationRunData; context: { aggregateId: string; tenantId: any } }> = [];

      for (const evaluation of doc.evaluations ?? []) {
        // Skip incomplete evaluations
        if (evaluation.status === "scheduled" || evaluation.status === "in_progress") {
          continue;
        }

        const evaluationId = evaluation.evaluation_id;
        const evalOccurredAt = evaluation.timestamps.started_at ?? evaluation.timestamps.inserted_at ?? occurredAt;
        const errorMessage = evaluation.error?.message ?? null;
        const errorDetails = evaluation.error?.stacktrace?.join("\n") ?? null;

        // Single EvaluationReportedEvent carries both identity + results
        const reportedEvent = EventUtils.createEvent<EvaluationReportedEvent>({
          aggregateType: "evaluation" as any,
          aggregateId: evaluationId,
          tenantId: tenantId as any,
          type: EVALUATION_REPORTED_EVENT_TYPE,
          version: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
          data: {
            evaluationId,
            evaluatorId: evaluation.evaluator_id,
            evaluatorType: evaluation.type ?? "unknown",
            evaluatorName: evaluation.name,
            traceId,
            isGuardrail: evaluation.is_guardrail ?? false,
            status: evaluation.status as "processed" | "error" | "skipped",
            score: typeof evaluation.score === "number" ? evaluation.score : null,
            passed: evaluation.passed ?? null,
            label: evaluation.label ?? null,
            details: evaluation.details ?? null,
            error: errorMessage,
            errorDetails,
          },
          occurredAt: evalOccurredAt,
          idempotencyKey: `${tenantId}:${evaluationId}:reported`,
        });

        // Compute evaluation fold projection
        let evalRunState = evalFoldProjection.init();
        evalRunState = evalFoldProjection.apply(
          evalRunState,
          reportedEvent as EvaluationProcessingEvent,
        );

        // Collect for bulk write
        evalBulkEntries.push({
          state: evalRunState,
          context: { aggregateId: evaluationId, tenantId: tenantId as any },
        });

        evalEvents.push(reportedEvent);
      }

      // ── 7. Build combined results ──
      const allEvents = [...traceEvents, ...evalEvents];
      const eventRecords = allEvents.map(eventToRecord);

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

      // Evaluation projection writes — bulk insert all evaluations for this trace
      if (evalBulkEntries.length > 0) {
        projectionWrites.push(() =>
          deps.evaluationRunStore.storeBatch(evalBulkEntries),
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
