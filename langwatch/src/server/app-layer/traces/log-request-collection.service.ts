import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "~/utils/types";
import {
  type RecordLogCommandData,
  piiRedactionLevelSchema,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpAnyValue } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  TraceRequestUtils,
  normalizeOtlpAttributeMap,
} from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import { traced } from "../tracing";

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

  static create(deps: LogRequestCollectionDeps): LogRequestCollectionService {
    return traced(
      new LogRequestCollectionService(deps),
      "LogRequestCollectionService",
    );
  }

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
                const body = this.extractBody(logRecord.body);
                if (body == null) {
                  droppedCount++;
                  continue;
                }

                const traceId = logRecord.traceId
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.traceId as string | Uint8Array,
                    )
                  : null;
                const spanId = logRecord.spanId
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.spanId as string | Uint8Array,
                    )
                  : null;

                if (!traceId || !spanId) {
                  droppedCount++;
                  continue;
                }

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
                  piiRedactionLevel: piiRedactionLevelSchema.parse(piiRedactionLevel),
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

        span.setAttribute("logs.ingestion.successes", collectedCount);
        span.setAttribute("logs.ingestion.drops", droppedCount);
        span.setAttribute("logs.ingestion.failures", failedCount);
      },
    );
  }

  private extractBody(body: unknown): string | null {
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
        return String((BigInt(v.high) << 32n) | (BigInt(v.low) & 0xffffffffn));
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
      return Buffer.from(anyValue.bytesValue).toString("base64");
    }
    if ("arrayValue" in anyValue && anyValue.arrayValue?.values) {
      const values = anyValue.arrayValue.values.map((v) => this.extractBody(v));
      return JSON.stringify(values);
    }
    if ("kvlistValue" in anyValue && anyValue.kvlistValue?.values) {
      const obj: Record<string, string | null> = {};
      for (const kv of anyValue.kvlistValue.values) {
        obj[kv.key] = this.extractBody(kv.value);
      }
      return JSON.stringify(obj);
    }

    return null;
  }
}
