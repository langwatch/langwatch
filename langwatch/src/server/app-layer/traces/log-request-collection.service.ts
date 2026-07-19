import { createLogger } from "@langwatch/observability";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type { DeepPartial } from "~/utils/types";
import {
  piiRedactionLevelSchema,
  type RecordLogCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpAnyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  normalizeOtlpAttributeMap,
  TraceRequestUtils,
} from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import { deriveLogContentAttributes } from "./log-content-derivation";
import { synthesizeTraceContext } from "./synthesize-trace-context";

/**
 * Attribute keys stamped on a recorded log whose trace context was
 * synthesized by LangWatch (see `synthesizeTraceContext`), so
 * downstream consumers can tell an id we minted apart from a real
 * OTLP id that arrived on the wire. `langwatch.trace.synthetic` marks
 * a trace_id we minted (the whole grouping is ours);
 * `langwatch.span.synthetic` marks the narrower case where the
 * trace_id is real but only the span_id was invented.
 */
const SYNTHETIC_TRACE_ATTR = "langwatch.trace.synthetic";
const SYNTHETIC_TRACE_DERIVED_FROM_ATTR = "langwatch.trace.derived_from";
const SYNTHETIC_SPAN_ATTR = "langwatch.span.synthetic";

export interface LogRequestCollectionDeps {
  recordLog: (data: RecordLogCommandData) => Promise<void>;
}

export class LogRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.log-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:log-ingestion",
  );

  constructor(private readonly deps: LogRequestCollectionDeps) {}

  async handleOtlpLogRequest({
    tenantId,
    logRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    logRequest: DeepPartial<IExportLogsServiceRequest>;
    piiRedactionLevel: string;
  }): Promise<void> {
    return await this.tracer.withActiveSpan(
      "LogRequestCollectionService.handleOtlpLogRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          resource_log_count: logRequest.resourceLogs?.length ?? 0,
        },
      },
      async (span) => {
        let collectedCount = 0;
        let droppedCount = 0;
        let failedCount = 0;

        const redaction = piiRedactionLevelSchema.parse(piiRedactionLevel);

        for (const resourceLog of logRequest.resourceLogs ?? []) {
          if (!resourceLog?.scopeLogs) continue;

          const resourceAttrs = normalizeOtlpAttributeMap(
            resourceLog.resource?.attributes,
          );

          for (const scopeLog of resourceLog.scopeLogs) {
            if (!scopeLog?.logRecords) continue;

            const scopeName =
              (scopeLog.scope?.name as string | undefined) ?? "";
            const scopeVersion =
              (scopeLog.scope?.version as string | undefined) ?? null;

            for (const logRecord of scopeLog.logRecords) {
              if (!logRecord) {
                droppedCount++;
                continue;
              }

              try {
                const body = extractBody(logRecord.body);
                if (body == null) {
                  droppedCount++;
                  continue;
                }

                // OTLP `LogRecord.trace_id` and `LogRecord.span_id` are
                // OPTIONAL per opentelemetry-proto v1.0.0 logs.proto — a
                // LogRecord emitted outside an active span has neither.
                // Dropping in that case silently eats every standalone log
                // (Claude Code's OTEL_LOGS_EXPORTER without a traces
                // exporter is the canonical caller). Store an empty
                // string instead; downstream join-to-span queries simply
                // find no correlation, which is the correct semantics.
                const wireTraceId = logRecord.traceId
                  ? (TraceRequestUtils.normalizeOtlpId(
                      logRecord.traceId as string | Uint8Array,
                    ) ?? "")
                  : "";
                const wireSpanId = logRecord.spanId
                  ? (TraceRequestUtils.normalizeOtlpId(
                      logRecord.spanId as string | Uint8Array,
                    ) ?? "")
                  : "";

                const logAttrs = normalizeOtlpAttributeMap(
                  logRecord.attributes,
                );
                const {
                  traceId,
                  spanId,
                  syntheticTraceId,
                  syntheticSpanId,
                  derivedFrom,
                } = synthesizeTraceContext({
                  scopeName,
                  wireTraceId,
                  wireSpanId,
                  attrs: logAttrs,
                });

                const timeUnixMs = logRecord.timeUnixNano
                  ? TraceRequestUtils.convertUnixNanoToUnixMs(
                      TraceRequestUtils.normalizeOtlpUnixNano(
                        logRecord.timeUnixNano as
                          | string
                          | number
                          | { low: number; high: number },
                      ),
                    )
                  : Date.now();

                // Every log record is recorded as-is; the event payload rides
                // the `body` attribute, already in logAttrs. The receiver adds
                // the synthetic-id markers below, plus the content derived from
                // any raw API body — parsed ONCE here rather than by every
                // consumer on every read (see `deriveLogContentAttributes`).
                const attributes: Record<string, string> = {
                  ...logAttrs,
                  ...deriveLogContentAttributes({
                    scopeName,
                    attributes: logAttrs,
                  }),
                };
                // A minted trace_id badges the whole trace synthetic (and
                // records which correlation key grouped it). A real trace_id
                // with only an invented span_id badges just the span — never
                // the trace, since a real trace can hold a context-less record.
                if (syntheticTraceId) {
                  attributes[SYNTHETIC_TRACE_ATTR] = "true";
                  attributes[SYNTHETIC_TRACE_DERIVED_FROM_ATTR] =
                    derivedFrom ?? "";
                } else if (syntheticSpanId) {
                  attributes[SYNTHETIC_SPAN_ATTR] = "true";
                }

                await this.deps.recordLog({
                  tenantId,
                  traceId,
                  spanId,
                  timeUnixMs,
                  severityNumber: (logRecord.severityNumber as number) ?? 0,
                  severityText: (logRecord.severityText as string) ?? "",
                  body,
                  attributes,
                  resourceAttributes: resourceAttrs,
                  scopeName,
                  scopeVersion,
                  piiRedactionLevel: redaction,
                  occurredAt: Date.now(),
                });

                collectedCount++;
              } catch (error) {
                failedCount++;
                this.logger.error(
                  {
                    error,
                    tenantId,
                  },
                  "Error processing log record",
                );
              }
            }
          }
        }

        // The receiver only appends log records, holding no cross-batch state.
        span.setAttribute("logs.ingestion.successes", collectedCount);
        span.setAttribute("logs.ingestion.drops", droppedCount);
        span.setAttribute("logs.ingestion.failures", failedCount);
      },
    );
  }
}

/**
 * Extracts the body string from an OTLP AnyValue.
 * Defined as a module-level function (not a class method) to avoid
 * being wrapped by the `traced()` proxy, which would turn this
 * synchronous function into an async one.
 */
function extractBody(body: unknown): string | null {
  if (body === null || body === undefined) return null;

  const anyValue = body as OtlpAnyValue;

  if (
    "stringValue" in anyValue &&
    anyValue.stringValue !== null &&
    anyValue.stringValue !== undefined
  ) {
    return anyValue.stringValue;
  }
  if (
    "boolValue" in anyValue &&
    anyValue.boolValue !== null &&
    anyValue.boolValue !== undefined
  ) {
    return String(anyValue.boolValue);
  }
  if (
    "intValue" in anyValue &&
    anyValue.intValue !== null &&
    anyValue.intValue !== undefined
  ) {
    const v = anyValue.intValue;
    if (typeof v === "object" && v !== null && "low" in v && "high" in v) {
      const raw = (BigInt(v.high) << 32n) | (BigInt(v.low) & 0xffffffffn);
      return BigInt.asIntN(64, raw).toString();
    }
    return String(v);
  }
  if (
    "doubleValue" in anyValue &&
    anyValue.doubleValue !== null &&
    anyValue.doubleValue !== undefined
  ) {
    return String(anyValue.doubleValue);
  }
  if (
    "bytesValue" in anyValue &&
    anyValue.bytesValue !== null &&
    anyValue.bytesValue !== undefined
  ) {
    return typeof anyValue.bytesValue === "string"
      ? anyValue.bytesValue
      : Buffer.from(anyValue.bytesValue).toString("base64");
  }
  if ("arrayValue" in anyValue && anyValue.arrayValue?.values) {
    const values = anyValue.arrayValue.values.map((v) => extractBody(v));
    return JSON.stringify(values);
  }
  if ("kvlistValue" in anyValue && anyValue.kvlistValue?.values) {
    const obj: Record<string, string | null> = {};
    for (const kv of anyValue.kvlistValue.values) {
      obj[kv.key] = extractBody(kv.value);
    }
    return JSON.stringify(obj);
  }

  return null;
}
