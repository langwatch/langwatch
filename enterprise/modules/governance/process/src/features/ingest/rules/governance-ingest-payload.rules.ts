// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the ingest receiver does to a payload before a pipeline sees it: the
 * receiver-authoritative origin stamp, the webhook envelope's one log record,
 * and the counts each acknowledgement reports.
 */
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
} from "@opentelemetry/otlp-transformer";

const RESERVED_ORIGIN_PREFIXES = ["langwatch.origin.", "langwatch.ingestion_source."] as const;

/**
 * Stamp `langwatch.origin.*` and `langwatch.ingestion_source.*` onto a
 * payload. Downstream consumers filter on
 * `langwatch.origin.kind = "ingestion_source"`, which is why these are
 * receiver-authoritative rather than advisory.
 */
function buildOriginAttrs(source: GovernanceIngestionSource): IKeyValue[] {
  return [
    { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
    { key: "langwatch.ingestion_source.id", value: { stringValue: source.id } },
    {
      key: "langwatch.ingestion_source.organization_id",
      value: { stringValue: source.organizationId },
    },
    { key: "langwatch.ingestion_source.source_type", value: { stringValue: source.sourceType } },
  ] as IKeyValue[];
}

/**
 * Receiver-authoritative origin attributes REPLACE any the payload supplied
 * under a reserved key: appending would leave two entries under one key and
 * let a payload forge its own origin.
 */
function withOriginAttrs(
  existing: IKeyValue[] | undefined,
  source: GovernanceIngestionSource,
): IKeyValue[] {
  const caller = (existing ?? []).filter(
    (attribute) => !RESERVED_ORIGIN_PREFIXES.some((prefix) => attribute.key?.startsWith(prefix)),
  );

  return [...caller, ...buildOriginAttrs(source)];
}

export function stampOriginAttrs(
  request: IExportTraceServiceRequest,
  source: GovernanceIngestionSource,
): void {
  for (const resourceSpans of request.resourceSpans ?? []) {
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        span.attributes = withOriginAttrs(span.attributes, source);
      }
    }
  }
}

export function stampLogOriginAttrs(
  request: IExportLogsServiceRequest,
  source: GovernanceIngestionSource,
): void {
  for (const resourceLogs of request.resourceLogs ?? []) {
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        record.attributes = withOriginAttrs(record.attributes, source);
      }
    }
  }
}

export function stampMetricOriginAttrs(input: {
  request: IExportMetricsServiceRequest;
  source: GovernanceIngestionSource;
}): void {
  for (const resourceMetrics of input.request.resourceMetrics ?? []) {
    const resource = resourceMetrics.resource ?? { attributes: [], droppedAttributesCount: 0 };

    resource.attributes = withOriginAttrs(resource.attributes, input.source);
    resourceMetrics.resource = resource;
  }
}

/**
 * Map a webhook envelope — arbitrary JSON pushed by an upstream platform —
 * onto ONE OTLP log record, because that keeps the unified-trace contract
 * simple: body is the raw JSON string, attributes carry the origin metadata.
 */
export function buildWebhookLogRequest({
  rawBody,
  source,
  nowNanos,
}: {
  rawBody: string;
  source: GovernanceIngestionSource;
  nowNanos: string;
}): IExportLogsServiceRequest {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: `ingestion-source/${source.sourceType}` },
            },
          ],
          droppedAttributesCount: 0,
        },
        scopeLogs: [
          {
            scope: { name: "langwatch.governance.ingestion", version: "1" },
            logRecords: [
              {
                timeUnixNano: nowNanos,
                observedTimeUnixNano: nowNanos,
                severityNumber: 9, // SeverityNumber.INFO
                severityText: "INFO",
                body: { stringValue: rawBody },
                attributes: buildOriginAttrs(source),
                droppedAttributesCount: 0,
                traceId: new Uint8Array(0),
                spanId: new Uint8Array(0),
                flags: 0,
              },
            ],
            schemaUrl: "",
          },
        ],
        schemaUrl: "",
      },
    ],
  };
}

/** Every span in a trace export, across resources and scopes. */
export function countSpans(request: IExportTraceServiceRequest): number {
  return (request.resourceSpans ?? []).flatMap((resourceSpans) =>
    (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) => scopeSpans.spans ?? []),
  ).length;
}

/** Every log record in a logs export, across resources and scopes. */
export function countLogRecords(request: IExportLogsServiceRequest): number {
  return (request.resourceLogs ?? []).reduce(
    (acc, resourceLogs) =>
      acc +
      (resourceLogs.scopeLogs ?? []).reduce(
        (scopeAcc, scopeLogs) => scopeAcc + (scopeLogs.logRecords?.length ?? 0),
        0,
      ),
    0,
  );
}

/** Every data point in a metrics export, across all five point shapes. */
export function countMetricDataPoints(request: IExportMetricsServiceRequest): number {
  return (request.resourceMetrics ?? []).reduce(
    (acc, resourceMetrics) =>
      acc +
      (resourceMetrics.scopeMetrics ?? []).reduce(
        (scopeAcc, scopeMetrics) =>
          scopeAcc +
          (scopeMetrics.metrics ?? []).reduce(
            (metricAcc, metric) =>
              metricAcc +
              (metric?.gauge?.dataPoints?.length ?? 0) +
              (metric?.sum?.dataPoints?.length ?? 0) +
              (metric?.histogram?.dataPoints?.length ?? 0) +
              (metric?.exponentialHistogram?.dataPoints?.length ?? 0) +
              (metric?.summary?.dataPoints?.length ?? 0),
            0,
          ),
        0,
      ),
    0,
  );
}

/**
 * Whether the payload carries metrics AT ALL, not whether its data-point
 * arrays are well-formed: a request whose metrics all have malformed data
 * points has a zero pre-count, and skipping validation would acknowledge it
 * as fully accepted with nothing rejected.
 */
export function hasMetricPayload(request: IExportMetricsServiceRequest): boolean {
  const resourceMetrics = request.resourceMetrics;

  return Array.isArray(resourceMetrics) ? resourceMetrics.length > 0 : resourceMetrics != null;
}
