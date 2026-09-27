import {
  type ContributeMetricFactsCommandData,
  deriveConversationKey,
  detectCodingAgent,
  isCodingAgentMetricName,
} from "@langwatch/coding-agent-contract";
import {
  type CanonicalMetricDataPoint,
  scalarsFromCanonicalAttributes,
} from "@langwatch/metric-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:coding-agent:metric-facts");

type MetricAttributes = Record<string, string | number | boolean>;

/** A received point either contributes session facts or is no coding-agent session's. */
export type MetricContribution =
  | { outcome: "contributes"; contribution: ContributeMetricFactsCommandData }
  | { outcome: "ignored" };

const IGNORED: MetricContribution = { outcome: "ignored" };

/** A received point's session contribution; converges CUMULATIVE by series or DELTA by point. */
export function liftMetricContribution(point: CanonicalMetricDataPoint): MetricContribution {
  if (!isCodingAgentMetricName(point.metricName)) return IGNORED;
  // Histograms and summaries carry no scalar total; the session vocabulary maps none of them.
  if (point.valueType === "none") return IGNORED;

  const attributes = parsePointAttributes(point.pointAttributesJson);
  if (attributes === null) return IGNORED;
  const sessionKey = deriveConversationKey(attributes);
  if (sessionKey === null) return IGNORED;

  const intValue = point.valueInt !== null ? Number(point.valueInt) : null;
  const value = point.valueType === "double" ? point.valueDouble : intValue;
  if (value === null || !Number.isFinite(value)) return IGNORED;

  const contribution: ContributeMetricFactsCommandData = {
    tenantId: point.tenantId,
    sessionId: sessionKey,
    sessionKeySource: "provider",
    agent: detectCodingAgent({
      recordName: point.metricName,
      scopeName: point.scopeName,
      // Only the resource's service.name separates Cowork from the Claude Code runtime it reuses.
      serviceName: extractServiceNameFromResource(point.resourceAttributesJson),
    }),
    occurredAt: point.timeUnixMs,
    seriesId: point.aggregationTemporality === "delta" ? point.pointId : point.seriesId,
    metricName: point.metricName,
    unit: point.metricUnit || null,
    attributes: liftScalarAttributes(attributes),
    value,
    dataPointCount: 1,
    asOfUnixMs: point.timeUnixMs,
  };
  return { outcome: "contributes", contribution };
}

/** Keep the series' identity attributes; anything structured stays behind. */
function liftScalarAttributes(attributes: MetricAttributes): MetricAttributes {
  const lifted: MetricAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string" || value.length > 0) {
      lifted[key] = value;
    }
  }
  return lifted;
}

/** The canonical KeyValue array build-point writes, flattened back to scalars. */
function parsePointAttributes(json: string): MetricAttributes | null {
  if (!json) return null;
  try {
    return scalarsFromCanonicalAttributes(JSON.parse(json));
  } catch (error) {
    // Written by our own preparation, so unreachable; one point must never poison the queue.
    logger.warn({ error }, "unparseable metric point attributes; skipping");
    return null;
  }
}

/** Resource-level service.name off the point's canonical KeyValue JSON. */
function extractServiceNameFromResource(json: string): string | null {
  const serviceName = parsePointAttributes(json)?.["service.name"];
  return typeof serviceName === "string" && serviceName.length > 0 ? serviceName : null;
}
