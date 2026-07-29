import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "../../metric-processing/schemas/constants";
import type { MetricProcessingEvent } from "../../metric-processing/schemas/events";
import type { ContributeMetricFactsCommandData } from "../schemas/commands";
import {
  detectCodingAgent,
  isCodingAgentMetricName,
  nonEmptyString,
  parseKeyValueCanonicalAttributes,
  resolveConversationKey,
} from "../services/coding-agent-normalization";

/**
 * The metric→session dispatcher (ADR-056 §2): a subscriber on
 * metric-processing's stored canonical datapoints that lifts a coding-agent
 * metric's session-keyed value and contributes it as a CONVERGED unit.
 *
 * Temporality decides what the unit is:
 * - a CUMULATIVE point already carries its series' converged total, so the
 *   unit is the series (`seriesId`) and a later observation replaces it;
 * - a DELTA point is an increment that must sum exactly once, so the unit is
 *   the point itself (`pointId`) — each delta is its own converged row, a
 *   re-delivery replaces it, and the read-side SUM adds them.
 * Either way the projection replaces and never increments (ADR-056 §5).
 *
 * A coding-agent metric with no session key is fleet-level by design
 * upstream (Codex, Copilot) — it stays in the canonical metric tables and
 * contributes nothing here.
 */
export function createCodingAgentMetricFactsDispatchSubscriber(deps: {
  contributeMetricFacts: (
    data: ContributeMetricFactsCommandData,
  ) => Promise<void>;
}): EventSubscriberDefinition<MetricProcessingEvent> {
  return {
    name: "codingAgentMetricFactsDispatch",
    eventTypes: [METRIC_DATA_POINT_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-metric-facts:${event.tenantId}:${event.data.pointId}`,
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      const point = event.data;
      if (!isCodingAgentMetricName(point.metricName)) return;
      // Histograms and summaries carry no scalar total; nothing the session
      // vocabulary maps arrives as one today.
      if (point.valueType === "none") return;

      const attributes = parseKeyValueCanonicalAttributes({
        json: point.pointAttributesJson,
        ref: { kind: "point", id: point.pointId },
      });
      if (attributes === null) return;
      const sessionKey = resolveConversationKey(attributes);
      if (sessionKey === null) return;

      const value =
        point.valueType === "double"
          ? point.valueDouble
          : point.valueInt !== null
            ? Number(point.valueInt)
            : null;
      if (value === null || !Number.isFinite(value)) return;

      const isDelta = point.aggregationTemporality === "delta";

      await deps.contributeMetricFacts({
        tenantId: point.tenantId,
        sessionId: sessionKey,
        sessionKeySource: "provider",
        agent: detectCodingAgent({
          recordName: point.metricName,
          scopeName: point.scopeName,
          // Resource service.name is the only signal that separates Cowork
          // from the Claude Code runtime it reuses; without it a session's
          // metric contribution could first-writer-win the fold's agent to
          // claude_code while its log contributions say claude_cowork.
          serviceName: serviceNameFromResource({
            json: point.resourceAttributesJson,
            pointId: point.pointId,
          }),
        }),
        occurredAt: point.timeUnixMs,
        seriesId: isDelta ? point.pointId : point.seriesId,
        metricName: point.metricName,
        unit: point.metricUnit || null,
        attributes: liftScalarAttributes(attributes),
        value,
        dataPointCount: 1,
        asOfUnixMs: point.timeUnixMs,
      });
    },
  };
}

/** Keep the series' identity attributes; anything structured stays behind. */
function liftScalarAttributes(
  attributes: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const lifted: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string" || value.length > 0) {
      lifted[key] = value;
    }
  }
  return lifted;
}

/** Resource-level service.name off the point's canonical KeyValue JSON. */
function serviceNameFromResource({
  json,
  pointId,
}: {
  json: string;
  pointId: string;
}): string | null {
  const resource = parseKeyValueCanonicalAttributes({
    json,
    ref: { kind: "point", id: pointId },
  });
  return nonEmptyString(resource?.["service.name"]);
}
