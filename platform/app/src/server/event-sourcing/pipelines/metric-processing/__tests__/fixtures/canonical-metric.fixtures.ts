import { prepareMetricDataPoints } from "../../canonicalMetric";

export const noRedaction = { redactMetricAttributes: async () => {} };

export function prepare({
  request,
  tenantId = "project-1",
  acceptedAt = 1_800_000_000_000,
}: {
  request: unknown;
  tenantId?: string;
  acceptedAt?: number;
}) {
  return prepareMetricDataPoints({
    tenantId,
    organizationId: "organization-1",
    request: request as never,
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt,
  });
}

/** Wraps a single metric in the smallest valid OTLP envelope. */
export function requestForMetric({
  metric,
  resourceAttributes = [],
  scopeAttributes = [],
}: {
  metric: Record<string, unknown>;
  resourceAttributes?: unknown[];
  scopeAttributes?: unknown[];
}) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes },
        schemaUrl: "resource-schema",
        scopeMetrics: [
          {
            scope: {
              name: "instrumentation",
              version: "1.2.3",
              attributes: scopeAttributes,
            },
            schemaUrl: "scope-schema",
            metrics: [metric],
          },
        ],
      },
    ],
  };
}

/** A minimal accepted gauge, for tests that only vary one field. */
export function gaugeMetric({
  name = "gauge.metric",
  dataPoints,
}: {
  name?: string;
  dataPoints: Array<Record<string, unknown>>;
}) {
  return { name, gauge: { dataPoints } };
}
