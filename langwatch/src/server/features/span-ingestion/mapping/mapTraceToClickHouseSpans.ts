import { SpanKind as ApiSpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes, HrTime } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger";
import type { SpanIngestionWriteRecord, IngestedSpan } from "../types";

const tracer = getLangWatchTracer("langwatch.span-ingestion.mapper");
const logger = createLogger("langwatch:span-ingestion:mapper");

export function mapReadableSpansToClickHouseSpans(
  records: SpanIngestionWriteRecord[],
  tenantId: string,
): IngestedSpan[] {
  return tracer.withActiveSpan(
    "mapReadableSpansToClickHouseSpans",
    { kind: ApiSpanKind.INTERNAL },
    (otelSpan) => {
      try {
        otelSpan.setAttributes({
          "tenant.id": tenantId,
          "spans.count": records.length,
        });

        const clickHouseSpans: IngestedSpan[] = [];

        for (const record of records) {
          try {
            clickHouseSpans.push(mapRecordToClickHouseSpan(record, tenantId));
          } catch (error) {
            logger.error(
              {
                error,
                spanId: record.readableSpan.spanContext().spanId,
                traceId: record.readableSpan.spanContext().traceId,
                tenantId,
              },
              "Failed to map span to ClickHouse format",
            );
          }
        }

        otelSpan.setAttribute("clickhouse.spans.mapped", clickHouseSpans.length);

        return clickHouseSpans;
      } catch (error) {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        otelSpan.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    },
  );
}

function mapRecordToClickHouseSpan(
  record: SpanIngestionWriteRecord,
  tenantId: string,
): IngestedSpan {
  const { readableSpan, originalSpan } = record;
  const spanContext = readableSpan.spanContext();
  const startTimestamp =
    hrTimeToDateTime64(readableSpan.startTime) ??
    millisToDateTime64(Date.now());

  const duration = Math.max(0, hrTimeToNanoseconds(readableSpan.duration));

  const spanAttributes = convertAttributes(readableSpan.attributes);
  applyLangWatchAttributes(originalSpan, spanAttributes);

  const statusCode =
    readableSpan.status.code === SpanStatusCode.ERROR
      ? "ERROR"
      : readableSpan.status.code === SpanStatusCode.OK
        ? "OK"
        : "UNSET";

  const statusMessage = readableSpan.status.message ?? null;

  const resourceAttributes = readableSpan.resource?.attributes
    ? convertAttributes(readableSpan.resource.attributes)
    : {};

  const eventsTimestamp: string[] = [];
  const eventsName: string[] = [];
  const eventsAttributes: Record<string, string>[] = [];

  for (const event of readableSpan.events) {
    eventsTimestamp.push(
      hrTimeToDateTime64(event.time) ?? startTimestamp,
    );
    eventsName.push(event.name);
    eventsAttributes.push(convertAttributes(event.attributes ?? {}));
  }

  const linksTraceId: string[] = [];
  const linksSpanId: string[] = [];
  const linksTraceState: string[] = [];
  const linksAttributes: Record<string, string>[] = [];

  for (const link of readableSpan.links) {
    linksTraceId.push(link.context.traceId);
    linksSpanId.push(link.context.spanId);

    const traceStateValue = link.context.traceState;
    const traceState =
      typeof traceStateValue === "string"
        ? traceStateValue
        : typeof traceStateValue?.serialize === "function"
          ? traceStateValue.serialize()
          : "";
    linksTraceState.push(traceState);

    linksAttributes.push(convertAttributes(link.attributes ?? {}));
  }

  return {
    id: "", // KSUID filled in consumer
    timestamp: startTimestamp,
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    parentSpanId: originalSpan.parent_id ?? null,
    traceState: record.traceState,
    spanName: readableSpan.name,
    spanKind: mapSpanKind(readableSpan.kind),
    serviceName: inferServiceName(originalSpan),
    resourceAttributes,
    spanAttributes,
    scopeName: readableSpan.instrumentationScope?.name ?? "",
    scopeVersion: readableSpan.instrumentationScope?.version ?? "",
    duration,
    statusCode,
    statusMessage,
    eventsTimestamp,
    eventsName,
    eventsAttributes,
    linksTraceId,
    linksSpanId,
    linksTraceState,
    linksAttributes,
    langWatchTenantId: tenantId,
  };
}

function mapSpanKind(kind: ApiSpanKind): string {
  switch (kind) {
    case ApiSpanKind.CLIENT:
      return "CLIENT";
    case ApiSpanKind.SERVER:
      return "SERVER";
    case ApiSpanKind.CONSUMER:
      return "CONSUMER";
    case ApiSpanKind.PRODUCER:
      return "PRODUCER";
    case ApiSpanKind.INTERNAL:
    default:
      return "INTERNAL";
  }
}

function inferServiceName(span: SpanIngestionWriteRecord["originalSpan"]): string {
  const serviceName = span.params?.service_name;
  return typeof serviceName === "string" ? serviceName : "unknown";
}

function applyLangWatchAttributes(
  span: SpanIngestionWriteRecord["originalSpan"],
  attributes: Record<string, string>,
): void {
  if (span.type) {
    attributes["langwatch.span_type"] = span.type;
  }

  if (span.input) {
    attributes["langwatch.input"] = JSON.stringify(span.input);
  }

  if (span.output) {
    attributes["langwatch.output"] = JSON.stringify(span.output);
  }

  if ("model" in span && span.model) {
    attributes["langwatch.model"] = span.model;
  }

  if ("vendor" in span && span.vendor) {
    attributes["langwatch.vendor"] = span.vendor;
  }

  if ("contexts" in span && span.contexts) {
    attributes["langwatch.contexts"] = JSON.stringify(span.contexts);
  }

  if (span.metrics) {
    for (const [key, value] of Object.entries(span.metrics)) {
      if (value !== null && value !== undefined) {
        attributes[`langwatch.metrics.${key}`] = String(value);
      }
    }
  }

  if (span.params) {
    for (const [key, value] of Object.entries(span.params)) {
      if (value !== null && value !== undefined) {
        attributes[`langwatch.params.${key}`] =
          typeof value === "string" ? value : JSON.stringify(value);
      }
    }
  }
}

function convertAttributes(source: Attributes): Record<string, string> {
  const target: Record<string, string> = {};

  for (const [key, value] of Object.entries(source ?? {})) {
    if (value === undefined) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      target[key] = String(value);
      continue;
    }

    if (Array.isArray(value)) {
      target[key] = JSON.stringify(value);
      continue;
    }

    target[key] = JSON.stringify(value);
  }

  return target;
}

function hrTimeToNanoseconds(hrTime: HrTime | undefined): number {
  if (!hrTime) return 0;
  const [seconds, nanoseconds] = hrTime;
  return seconds * 1_000_000_000 + nanoseconds;
}

function hrTimeToDateTime64(hrTime: HrTime | undefined): string | undefined {
  if (!hrTime) return undefined;
  const [seconds, nanoseconds] = hrTime;
  const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  return formatDateTime64(date, nanoseconds);
}

function millisToDateTime64(milliseconds: number): string {
  const date = new Date(milliseconds);
  const nanoseconds = (milliseconds % 1000) * 1_000_000;
  return formatDateTime64(date, nanoseconds);
}

function formatDateTime64(date: Date, nanoseconds: number): string {
  const iso = date.toISOString();
  const base = iso.slice(0, 19).replace("T", " ");
  const fraction = String(nanoseconds).padStart(9, "0");
  return `${base}.${fraction}`;
}

