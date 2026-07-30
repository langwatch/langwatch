import type { Metrics } from "@langwatch/event-sourcing";
import { noopMetrics } from "@langwatch/event-sourcing";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type {
  LogFactsContribution,
  MetricFactsContribution,
  SpanFactsContribution,
} from "../schema";
import { resolveCodingAgentSessionId } from "../sessionIdentity";
import type { CodingAgentDetectionPort } from "./detection.types";
import type { CodingAgentBridgeSubscriber } from "./subscriber.types";

/**
 * The three source -> session bridges. A bridge, not a direct subscription,
 * because the session id is neither a trace id, a log record id nor a metric
 * point id (ADR-098 §9).
 *
 * All three resolve the session the same way and drop the same way — counted,
 * never silent. They differ only in what they can supply as `traceId`: a span
 * always carries one, a log record only when correlation resolved, a metric
 * point never. Each poke is losable and at-most-once;
 * `contributionSweep.ts` is the guarantee.
 */

const DROP_METRIC_NAME = "es_coding_agent_bridge_drop_total";
const DROP_METRIC_HELP =
  "Coding-agent contribution bridge drops, by signal and reason — every path that does not dispatch a contribution.";

function dropCounter(metrics: Metrics) {
  return metrics.counter({
    name: DROP_METRIC_NAME,
    help: DROP_METRIC_HELP,
    labelNames: ["signal", "reason"],
  });
}

// ---------------------------------------------------------------------------
// Span bridge
// ---------------------------------------------------------------------------

export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received";

/** The minimal shape this bridge reads off trace-processing's (unconverted) `span_received` event. */
export interface SpanReceivedEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly occurredAt: number;
  readonly data: {
    readonly span: { readonly name?: unknown } & Record<string, unknown>;
    readonly resource: Record<string, unknown>;
    readonly instrumentationScope: Record<string, unknown>;
  };
}

export interface SpanFactsBridgeDeps {
  readonly detection: CodingAgentDetectionPort;
  readonly contributeSpanFacts: (
    data: ContributeSpanFactsCommandInput,
  ) => Promise<void>;
  readonly metrics?: Metrics;
  readonly now?: () => number;
}

export function createSpanFactsBridge(
  deps: SpanFactsBridgeDeps,
): CodingAgentBridgeSubscriber<SpanReceivedEvent> {
  const metrics = deps.metrics ?? noopMetrics;
  const drops = dropCounter(metrics);
  const now = deps.now ?? Date.now;
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  const isCodingAgentSpan = (event: SpanReceivedEvent): boolean => {
    const rawName = event.data.span.name;
    return (
      typeof rawName === "string" &&
      deps.detection.isCodingAgentSpanName(rawName)
    );
  };

  return {
    name: "codingAgentSpanFactsBridge",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    enqueue: { filter: isCodingAgentSpan },
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-span-facts:${event.tenantId}:${String((event.data.span as { spanId?: unknown }).spanId ?? "")}`,
        ttlMs: 60_000,
      },
    },
    async handle(event) {
      if (!isCodingAgentSpan(event)) return;

      const span = normalization.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );

      const providerSessionKey = deps.detection.resolveConversationKey(
        span.spanAttributes,
      );
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey,
        traceId: span.traceId,
      });
      if (resolved === null) {
        // Unreachable for spans — every span carries a traceId — but
        // counted rather than assumed.
        drops.inc({ signal: "span", reason: "no_session_key" });
        return;
      }

      const agent = deps.detection.detectAgent({
        recordName: span.name,
        scopeName: (span.instrumentationScope as { name?: string }).name,
        serviceName:
          typeof span.resourceAttributes["service.name"] === "string"
            ? (span.resourceAttributes["service.name"] as string)
            : null,
      });
      if (agent === "unknown") {
        drops.inc({ signal: "span", reason: "unknown_agent" });
        return;
      }

      await deps.contributeSpanFacts({
        tenantId: event.tenantId,
        sessionId: resolved.sessionId,
        sessionKeySource: resolved.sessionKeySource,
        agent,
        occurredAt: event.occurredAt,
        acceptedAt: now(),
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        startTimeUnixMs: span.startTimeUnixMs,
        endTimeUnixMs: span.endTimeUnixMs,
        statusCode: span.statusCode ?? 0,
        facts: deps.detection.liftSpanFacts(span.spanAttributes),
        scopeName:
          (span.instrumentationScope as { name?: string }).name || null,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Log bridge
// ---------------------------------------------------------------------------

export const CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE = "log/recordReceived";

/** The fields this bridge reads off log-processing's canonical record — see `log-processing/schema.ts`. */
export interface LogRecordReceivedEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly occurredAt: number;
  readonly data: {
    readonly recordId: string;
    readonly scopeName: string;
    readonly eventName: string;
    readonly attributesFlatJson: string;
    readonly resourceAttributesFlatJson: string;
    readonly correlationSource: string;
    readonly correlationTraceId: string;
    readonly correlationSpanId: string;
    readonly providerSessionId: string;
    readonly providerKind: string;
    readonly severityNumber: number | null;
    readonly timeUnixMs: number;
    readonly acceptedAt: number;
  };
}

export interface LogFactsBridgeDeps {
  readonly detection: CodingAgentDetectionPort;
  readonly contributeLogFacts: (
    data: ContributeLogFactsCommandInput,
  ) => Promise<void>;
  readonly metrics?: Metrics;
  readonly parseFlatAttributes: (
    json: string,
  ) => Record<string, unknown> | null;
}

export function createLogFactsBridge(
  deps: LogFactsBridgeDeps,
): CodingAgentBridgeSubscriber<LogRecordReceivedEvent> {
  const metrics = deps.metrics ?? noopMetrics;
  const drops = dropCounter(metrics);

  return {
    name: "codingAgentLogFactsBridge",
    eventTypes: [CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-log-facts:${event.tenantId}:${event.data.recordId}`,
        ttlMs: 60_000,
      },
    },
    async handle(event) {
      const record = event.data;
      const attributes = deps.parseFlatAttributes(record.attributesFlatJson);
      if (attributes === null) {
        drops.inc({ signal: "log", reason: "unparseable_attributes" });
        return;
      }
      if (record.eventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = record.eventName;
      }

      const facts = deps.detection.liftLogFacts({
        scopeName: record.scopeName,
        attributes,
      });
      if (facts === null) {
        // Not a coding-agent record at all — the cheap gate, not a drop.
        return;
      }

      const resourceAttributes = deps.parseFlatAttributes(
        record.resourceAttributesFlatJson,
      );
      const serviceName =
        typeof resourceAttributes?.["service.name"] === "string"
          ? (resourceAttributes["service.name"] as string)
          : null;

      const providerSessionKey =
        deps.detection.resolveConversationKey(attributes) ??
        (record.providerSessionId || null);
      const correlationTraceId =
        record.correlationSource !== "none" && record.correlationTraceId
          ? record.correlationTraceId
          : null;
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey,
        traceId: correlationTraceId,
      });
      if (resolved === null) {
        drops.inc({ signal: "log", reason: "no_session_key" });
        return;
      }

      const agent = deps.detection.detectAgent({
        scopeName: record.scopeName,
        recordName:
          typeof attributes["event.name"] === "string"
            ? (attributes["event.name"] as string)
            : null,
        serviceName,
      });
      if (agent === "unknown") {
        drops.inc({ signal: "log", reason: "unknown_agent" });
        return;
      }

      await deps.contributeLogFacts({
        tenantId: record.tenantId ? String(record.tenantId) : event.tenantId,
        sessionId: resolved.sessionId,
        sessionKeySource: resolved.sessionKeySource,
        agent,
        occurredAt: record.timeUnixMs,
        // The canonical log record's own `acceptedAt` — our platform's real
        // ingest boundary for THIS record, not a value re-derived at bridge
        // dispatch time (unlike the span bridge, which has no such field
        // available from its unconverted source pipeline yet).
        acceptedAt: record.acceptedAt,
        recordId: record.recordId,
        traceId: correlationTraceId,
        spanId:
          record.correlationSource !== "none" && record.correlationSpanId
            ? record.correlationSpanId
            : null,
        timeUnixMs: record.timeUnixMs,
        severityNumber: record.severityNumber,
        providerKind: record.providerKind,
        scopeName: record.scopeName || null,
        facts,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Metric bridge
// ---------------------------------------------------------------------------

export const METRIC_DATA_POINT_RECEIVED_EVENT_TYPE = "metric/dataPointReceived";

/** The fields this bridge reads off metric-processing's canonical data point — see `metric-processing/schema.ts`. */
export interface MetricDataPointReceivedEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly data: {
    readonly pointId: string;
    readonly seriesId: string;
    readonly metricName: string;
    readonly metricUnit: string;
    readonly scopeName: string;
    readonly aggregationTemporality: "unspecified" | "delta" | "cumulative";
    readonly valueType: "none" | "int" | "double";
    readonly valueInt: string | null;
    readonly valueDouble: number | null;
    readonly timeUnixMs: number;
    readonly acceptedAt: number;
    readonly pointAttributesJson: string;
    readonly resourceAttributesJson: string;
  };
}

export interface MetricFactsBridgeDeps {
  readonly detection: CodingAgentDetectionPort;
  readonly contributeMetricFacts: (
    data: ContributeMetricFactsCommandInput,
  ) => Promise<void>;
  readonly metrics?: Metrics;
  readonly parseKeyValueAttributes: (
    json: string,
  ) => Record<string, string | number | boolean> | null;
}

export function createMetricFactsBridge(
  deps: MetricFactsBridgeDeps,
): CodingAgentBridgeSubscriber<MetricDataPointReceivedEvent> {
  const metrics = deps.metrics ?? noopMetrics;
  const drops = dropCounter(metrics);

  const isCodingAgentMetric = (event: MetricDataPointReceivedEvent): boolean =>
    deps.detection.isCodingAgentMetricName(event.data.metricName);

  return {
    name: "codingAgentMetricFactsBridge",
    eventTypes: [METRIC_DATA_POINT_RECEIVED_EVENT_TYPE],
    enqueue: { filter: isCodingAgentMetric },
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-metric-facts:${event.tenantId}:${event.data.pointId}`,
        ttlMs: 60_000,
      },
    },
    async handle(event) {
      const point = event.data;
      if (!isCodingAgentMetric(event)) return;
      if (point.valueType === "none") {
        // Histograms/summaries carry no scalar total — nothing in the
        // session vocabulary maps a distribution today. A real gap, not a
        // failure: counted distinctly so it can be told apart from one.
        drops.inc({ signal: "metric", reason: "no_scalar_value" });
        return;
      }

      const attributes = deps.parseKeyValueAttributes(
        point.pointAttributesJson,
      );
      if (attributes === null) {
        drops.inc({ signal: "metric", reason: "unparseable_attributes" });
        return;
      }

      const providerSessionKey =
        deps.detection.resolveConversationKey(attributes);
      // Metric datapoints carry no inline trace correlation — see the
      // module docblock. `traceId: null` is honest about the signal, not a
      // fourth give-up behaviour.
      const resolved = resolveCodingAgentSessionId({
        providerSessionKey,
        traceId: null,
      });
      if (resolved === null) {
        drops.inc({ signal: "metric", reason: "no_session_key" });
        return;
      }

      const value =
        point.valueType === "double"
          ? point.valueDouble
          : point.valueInt !== null
            ? Number(point.valueInt)
            : null;
      if (value === null || !Number.isFinite(value)) {
        drops.inc({ signal: "metric", reason: "non_finite_value" });
        return;
      }

      const resourceAttributes = deps.parseKeyValueAttributes(
        point.resourceAttributesJson,
      );
      const serviceName =
        typeof resourceAttributes?.["service.name"] === "string"
          ? (resourceAttributes["service.name"] as string)
          : null;
      const agent = deps.detection.detectAgent({
        recordName: point.metricName,
        scopeName: point.scopeName,
        serviceName,
      });
      if (agent === "unknown") {
        drops.inc({ signal: "metric", reason: "unknown_agent" });
        return;
      }

      const isDelta = point.aggregationTemporality === "delta";

      await deps.contributeMetricFacts({
        tenantId: event.tenantId,
        sessionId: resolved.sessionId,
        sessionKeySource: resolved.sessionKeySource,
        agent,
        occurredAt: point.timeUnixMs,
        // The canonical metric point's own `acceptedAt` — genuinely
        // platform-set, per `metric-processing/schema.ts`.
        acceptedAt: point.acceptedAt,
        seriesId: isDelta ? point.pointId : point.seriesId,
        metricName: point.metricName,
        unit: point.metricUnit || null,
        attributes: deps.detection.liftMetricAttributes(attributes),
        value,
        dataPointCount: 1,
        asOfUnixMs: point.timeUnixMs,
      });
    },
  };
}
