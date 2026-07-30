import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type {
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/otlp";
import type {
  LogFactsContribution,
  MetricFactsContribution,
  SpanFactsContribution,
} from "../schema";
import { resolveCodingAgentSessionId } from "../sessionIdentity";
import type { CodingAgentDetectionPort } from "./detection.types";
import type { CodingAgentBridgeSubscriber } from "./subscriber.types";

/**
 * The three source -> session bridges. All three resolve the session the same
 * way and drop the same way — counted, never silent. They differ only in what
 * they can supply as `traceId`: a span always carries one, a log record only
 * when correlation resolved, a metric point never. Each poke is losable and
 * at-most-once; `contributionSweep.ts` is the guarantee.
 *
 * `eventTypes` comes from the composition root, from the source pipeline's own
 * declaration (ADR-102 decision 5, dependencies point downward only).
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

/** The minimal shape this bridge reads off trace-processing's `span_received` event. */
export interface SpanReceivedEvent {
  readonly type: string;
  readonly tenantId: string;
  readonly occurredAt: number;
  readonly data: {
    readonly span: OtlpSpan;
    readonly resource: OtlpResource;
    readonly instrumentationScope: OtlpInstrumentationScope;
  };
}

export interface SpanFactsBridgeDeps {
  readonly eventTypes: readonly string[];
  readonly detection: CodingAgentDetectionPort;
  readonly contributeSpanFacts: (data: SpanFactsContribution) => Promise<void>;
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

  const isCodingAgentSpan = (event: SpanReceivedEvent): boolean =>
    deps.detection.isCodingAgentSpanName(event.data.span.name);

  return {
    name: "codingAgentSpanFactsBridge",
    eventTypes: deps.eventTypes,
    enqueue: { filter: isCodingAgentSpan },
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-span-facts:${event.tenantId}:${event.data.span.spanId}`,
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
        // Unreachable for spans — every span carries a traceId — but counted
        // rather than assumed.
        drops.inc({ signal: "span", reason: "no_session_key" });
        return;
      }

      const serviceName = span.resourceAttributes["service.name"];
      const agent = deps.detection.detectAgent({
        recordName: span.name,
        scopeName: span.instrumentationScope.name,
        serviceName: typeof serviceName === "string" ? serviceName : null,
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
        scopeName: span.instrumentationScope.name || null,
      });
    },
  };
}

/** The fields this bridge reads off log-processing's canonical record. */
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
  readonly eventTypes: readonly string[];
  readonly detection: CodingAgentDetectionPort;
  readonly contributeLogFacts: (data: LogFactsContribution) => Promise<void>;
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
    eventTypes: deps.eventTypes,
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
      // Not a coding-agent record at all — the cheap gate, not a drop.
      if (facts === null) return;

      const resourceAttributes = deps.parseFlatAttributes(
        record.resourceAttributesFlatJson,
      );
      const serviceName = resourceAttributes?.["service.name"];
      const recordName = attributes["event.name"];

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
        recordName: typeof recordName === "string" ? recordName : null,
        serviceName: typeof serviceName === "string" ? serviceName : null,
      });
      if (agent === "unknown") {
        drops.inc({ signal: "log", reason: "unknown_agent" });
        return;
      }

      await deps.contributeLogFacts({
        tenantId: event.tenantId,
        sessionId: resolved.sessionId,
        sessionKeySource: resolved.sessionKeySource,
        agent,
        occurredAt: record.timeUnixMs,
        // The canonical record's own ingest stamp — this record's real platform
        // boundary, not a value re-derived at bridge dispatch time.
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

/** The fields this bridge reads off metric-processing's canonical data point. */
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
  readonly eventTypes: readonly string[];
  readonly detection: CodingAgentDetectionPort;
  readonly contributeMetricFacts: (
    data: MetricFactsContribution,
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
    eventTypes: deps.eventTypes,
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
        // Histograms and summaries carry no scalar total, and nothing in the
        // session vocabulary maps a distribution today. Counted distinctly so a
        // gap can be told apart from a failure.
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
      // A metric point carries no inline trace correlation, so `traceId: null`
      // is honest about the signal rather than a fourth give-up behaviour.
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
      const serviceName = resourceAttributes?.["service.name"];
      const agent = deps.detection.detectAgent({
        recordName: point.metricName,
        scopeName: point.scopeName,
        serviceName: typeof serviceName === "string" ? serviceName : null,
      });
      if (agent === "unknown") {
        drops.inc({ signal: "metric", reason: "unknown_agent" });
        return;
      }

      // A delta point is its own series of one: adding deltas is exactly what
      // ADR-103 forbids, so each is keyed by the point that carried it.
      const isDelta = point.aggregationTemporality === "delta";

      await deps.contributeMetricFacts({
        tenantId: event.tenantId,
        sessionId: resolved.sessionId,
        sessionKeySource: resolved.sessionKeySource,
        agent,
        occurredAt: point.timeUnixMs,
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
