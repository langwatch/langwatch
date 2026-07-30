import { prepareMetricDataPoints } from "../prepareMetricDataPoints";
import type { CanonicalMetricDataPoint } from "../schema";

export const noRedaction = { redactMetricAttributes: async () => {} };

export function prepare(args: {
  request: unknown;
  tenantId?: string;
  acceptedAt?: number;
}) {
  return prepareMetricDataPoints({
    tenantId: args.tenantId ?? "project-1",
    organizationId: "organization-1",
    request: args.request as never,
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt: args.acceptedAt ?? 1_800_000_000_000,
  });
}

/** Wraps a single metric in the smallest valid OTLP envelope. */
export function requestForMetric(args: {
  metric: Record<string, unknown>;
  resourceAttributes?: unknown[];
  scopeAttributes?: unknown[];
}) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: args.resourceAttributes ?? [] },
        schemaUrl: "resource-schema",
        scopeMetrics: [
          {
            scope: {
              name: "instrumentation",
              version: "1.2.3",
              attributes: args.scopeAttributes ?? [],
            },
            schemaUrl: "scope-schema",
            metrics: [args.metric],
          },
        ],
      },
    ],
  };
}

export function gaugeMetric(args: {
  name?: string;
  dataPoints: Array<Record<string, unknown>>;
}) {
  return {
    name: args.name ?? "gauge.metric",
    gauge: { dataPoints: args.dataPoints },
  };
}

/** A canonical point with only the fields a rollup test cares about set. */
export function point(
  overrides: Partial<CanonicalMetricDataPoint> & { timeUnixMs: number },
): CanonicalMetricDataPoint {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    pointId: String(overrides.timeUnixMs).padStart(64, "0"),
    seriesId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: "metric",
    metricDescription: "",
    metricUnit: "1",
    metricKind: "gauge",
    aggregationTemporality: "unspecified",
    isMonotonic: null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: "1",
    timeUnixNano: String(BigInt(overrides.timeUnixMs) * 1_000_000n),
    flags: 0,
    valueType: "double",
    valueInt: null,
    valueDouble: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: null,
    positiveOffset: null,
    positiveBucketCounts: [],
    negativeOffset: null,
    negativeBucketCounts: [],
    summaryQuantilesJson: "[]",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: overrides.timeUnixMs,
    acceptedAt: 1_800_000_000_000,
    ...overrides,
  };
}
