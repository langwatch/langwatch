import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "~/utils/types";
import {
  piiRedactionLevelSchema,
  type RecordLogCommandData,
  type RecordSpanCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpAnyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  normalizeOtlpAttributeMap,
  TraceRequestUtils,
} from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import {
  CLAUDE_CODE_EVENT_SCOPE,
  synthesizeClaudeCodeSpans,
  type ClaudeCodeLogRecordView,
} from "./claude-code-log-to-span.synthesizer";

export interface LogRequestCollectionDeps {
  recordLog: (data: RecordLogCommandData) => Promise<void>;
  /**
   * Optional: when supplied, the service synthesizes a gen_ai span
   * from claude_code.events log records and records it alongside
   * the raw log. Omit in tests / receivers that only want the raw
   * log persistence path.
   */
  recordSpan?: (data: RecordSpanCommandData) => Promise<void>;
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

        const claudeViewsForSynthesis: ClaudeCodeLogRecordView[] = [];
        const claudeResourceByScope = new Map<
          string,
          { resourceAttrs: Record<string, string>; scopeVersion: string | null }
        >();

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

            if (scopeName === CLAUDE_CODE_EVENT_SCOPE) {
              claudeResourceByScope.set(scopeName, {
                resourceAttrs,
                scopeVersion,
              });
            }

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
                const traceId = logRecord.traceId
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.traceId as string | Uint8Array,
                    ) ?? ""
                  : "";
                const spanId = logRecord.spanId
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.spanId as string | Uint8Array,
                    ) ?? ""
                  : "";

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

                const logAttrs = normalizeOtlpAttributeMap(
                  logRecord.attributes,
                );

                if (
                  scopeName === CLAUDE_CODE_EVENT_SCOPE &&
                  this.deps.recordSpan
                ) {
                  claudeViewsForSynthesis.push({
                    scopeName,
                    attrs: logAttrs,
                    resourceAttrs,
                    timeUnixNano: logRecord.timeUnixNano
                      ? TraceRequestUtils.normalizeOtlpUnixNano(
                          logRecord.timeUnixNano as
                            | string
                            | number
                            | { low: number; high: number },
                        )
                      : null,
                  });
                }

                await this.deps.recordLog({
                  tenantId,
                  traceId,
                  spanId,
                  timeUnixMs,
                  severityNumber: (logRecord.severityNumber as number) ?? 0,
                  severityText: (logRecord.severityText as string) ?? "",
                  body,
                  attributes: logAttrs,
                  resourceAttributes: resourceAttrs,
                  scopeName,
                  scopeVersion,
                  piiRedactionLevel:
                    piiRedactionLevelSchema.parse(piiRedactionLevel),
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

        let synthesizedSpanCount = 0;
        if (this.deps.recordSpan && claudeViewsForSynthesis.length > 0) {
          const synthesized = synthesizeClaudeCodeSpans(
            claudeViewsForSynthesis,
          );
          const claudeResource = claudeResourceByScope.get(
            CLAUDE_CODE_EVENT_SCOPE,
          );
          for (const syn of synthesized) {
            try {
              await this.deps.recordSpan({
                tenantId,
                span: syn,
                resource: claudeResource?.resourceAttrs
                  ? {
                      attributes: Object.entries(
                        claudeResource.resourceAttrs,
                      ).map(([key, value]) => ({
                        key,
                        value: { stringValue: value },
                      })),
                    }
                  : null,
                instrumentationScope: {
                  name: CLAUDE_CODE_EVENT_SCOPE,
                  version: claudeResource?.scopeVersion ?? null,
                },
                piiRedactionLevel:
                  piiRedactionLevelSchema.parse(piiRedactionLevel),
                occurredAt: Date.now(),
              });
              synthesizedSpanCount++;
            } catch (error) {
              this.logger.error(
                { error, tenantId, traceId: syn.traceId, spanId: syn.spanId },
                "Error recording synthesized claude_code span",
              );
            }
          }
        }

        span.setAttribute("logs.ingestion.successes", collectedCount);
        span.setAttribute("logs.ingestion.drops", droppedCount);
        span.setAttribute("logs.ingestion.failures", failedCount);
        span.setAttribute(
          "logs.ingestion.synthesized_spans",
          synthesizedSpanCount,
        );
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
