import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "../schemas/constants";
import type {
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
} from "../schemas/events";
import {
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  TraceOriginService,
  TraceAttributeAccumulationService,
  TraceIOAccumulationService,
  ScenarioRoleCostService,
  shouldOverrideOutput,
  extractIOFromLogRecord,
  OUTPUT_SOURCE,
} from "./services";
import {
  extractSpanMetrics,
  spanCostService,
} from "./services/spanMetricsExtractor";

export type { TraceSummaryData };

const COMPUTED_IO_SCHEMA_VERSION = "2025-12-18" as const;

// ─── Composition root ────────────────────────────────────────────────

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

const traceOriginService = new TraceOriginService();
const traceAttributeAccumulationService =
  new TraceAttributeAccumulationService(traceOriginService);
const traceIOExtractionService = new TraceIOExtractionService();
const traceIOAccumulationService = new TraceIOAccumulationService(
  traceIOExtractionService,
);
const scenarioRoleCostService = new ScenarioRoleCostService(spanCostService);

// ─── Main composition ───────────────────────────────────────────────

/** @internal Exported for unit testing */
export function applySpanToSummary({
  state,
  span,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
}): TraceSummaryData {
  // Use shared extractor for metrics consistency with analyticsTraceFacts
  const metrics = extractSpanMetrics({ timingState: state, span });

  const tokens = spanCostService.accumulateTokens({
    state,
    span,
    totalDurationMs: metrics.timing.totalDurationMs,
  });

  const io = traceIOAccumulationService.accumulateIO({ state, span });
  const attributes = traceAttributeAccumulationService.accumulateAttributes({
    state,
    span,
    outputSource: io.outputSource,
  });

  const models =
    metrics.models.length > 0
      ? [...new Set([...state.models, ...metrics.models])].sort()
      : state.models;

  const roleAccumulation = scenarioRoleCostService.accumulateRoleCostLatency({
    state,
    span,
  });

  return {
    ...state,
    traceId: state.traceId || span.traceId,
    spanCount: state.spanCount + 1,
    computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
    occurredAt: metrics.timing.occurredAt,
    totalDurationMs: metrics.timing.totalDurationMs,
    models,
    ...tokens,
    containsErrorStatus: state.containsErrorStatus || metrics.status.hasError,
    containsOKStatus: state.containsOKStatus || metrics.status.hasOK,
    errorMessage: state.errorMessage ?? metrics.status.errorMessage,
    computedInput: io.computedInput,
    computedOutput: io.computedOutput,
    outputFromRootSpan: io.outputFromRootSpan,
    outputSpanEndTimeMs: io.outputSpanEndTimeMs,
    blockedByGuardrail: io.blockedByGuardrail,
    attributes,
    ...roleAccumulation,
  };
}

// ─── Fold projection class ──────────────────────────────────────────

const traceSummaryEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
] as const;

/**
 * Type-safe fold projection for trace summary state.
 *
 * - `implements FoldEventHandlers` enforces a handler exists for every event schema
 * - Handler names derived from event type strings (e.g. `"lw.obs.trace.span_received"` -> `handleTraceSpanReceived`)
 * - `updatedAt` is auto-managed by the base class after each handler call (camelCase)
 */
export class TraceSummaryFoldProjection
  extends AbstractFoldProjection<TraceSummaryData, typeof traceSummaryEvents>
  implements FoldEventHandlers<typeof traceSummaryEvents, TraceSummaryData>
{
  readonly name = "traceSummary";
  readonly version = TRACE_SUMMARY_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceSummaryData>;
  protected override readonly timestampStyle = "camel" as const;

  protected readonly events = traceSummaryEvents;

  constructor(deps: { store: FoldProjectionStore<TraceSummaryData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      traceId: "",
      spanCount: 0,
      totalDurationMs: 0,
      computedIOSchemaVersion: COMPUTED_IO_SCHEMA_VERSION,
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: false,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      topicId: null,
      subTopicId: null,
      hasAnnotation: null,
      attributes: {},
      scenarioRoleCosts: {},
      scenarioRoleLatencies: {},
      scenarioRoleSpans: {},
      spanCosts: {},
      // Sentinel: 0 means "no spans received yet". The timing function uses
      // occurredAt > 0 to decide first-span vs min-of-existing. Using Date.now()
      // here would break Math.min logic -- wall-clock time >> span startTimeUnixMs.
      occurredAt: 0,
    };
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const normalizedSpan =
      spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    enrichRagContextIds(normalizedSpan);

    return {
      ...applySpanToSummary({ state, span: normalizedSpan }),
      createdAt: state.createdAt,
    };
  }

  handleTraceTopicAssigned(
    event: TopicAssignedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    return {
      ...state,
      topicId: event.data.topicId ?? state.topicId,
      subTopicId: event.data.subtopicId ?? state.subTopicId,
    };
  }

  handleTraceLogRecordReceived(
    event: LogRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(
      mergedAttributes["langwatch.reserved.log_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.log_record_count"] = String(
      logCount + 1,
    );

    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED;

    const logIO = extractIOFromLogRecord(event.data);

    if (logIO.input !== null && computedInput === null) {
      computedInput = logIO.input;
    }

    if (logIO.output !== null) {
      if (
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: state.outputFromRootSpan,
          isExplicit: false,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: event.data.timeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        })
      ) {
        computedOutput = logIO.output;
        outputSpanEndTimeMs = event.data.timeUnixMs;
        mergedAttributes["langwatch.reserved.output_source"] =
          OUTPUT_SOURCE.INFERRED;
      }
    }

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      computedInput,
      computedOutput,
      outputSpanEndTimeMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (event.data.metricName === "gen_ai.server.time_to_first_token") {
      const ttftMs = event.data.value * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    const mergedAttributes = { ...state.attributes };
    const metricCount = parseInt(
      mergedAttributes["langwatch.reserved.metric_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.metric_record_count"] = String(
      metricCount + 1,
    );

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      timeToFirstTokenMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceOriginResolved(
    event: OriginResolvedEvent,
    state: TraceSummaryData,
  ): TraceSummaryData {
    const currentOrigin = state.attributes["langwatch.origin"];
    if (currentOrigin) {
      // Explicit origin already set -- do not override
      return state;
    }
    return {
      ...state,
      attributes: {
        ...state.attributes,
        "langwatch.origin": event.data.origin,
      },
    };
  }
}
