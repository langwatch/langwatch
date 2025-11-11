import type { DeepPartial } from "~/utils/types";
import type { SpanInputOutput } from "./types";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { createLogger } from "~/utils/logger";
import { otelAttributesToNestedAttributes, type TraceForCollection } from "./otel.traces";
import { decodeOpenTelemetryId, convertFromUnixNano } from "./utils";
import { getLangWatchTracer } from "langwatch";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { generateOtelSpanId, generateOtelTraceId } from "../../utils/trace";

const logger = createLogger("langwatch.tracer.otel.logs");
const tracer = getLangWatchTracer("langwatch.tracer.otel.logs");

const springAIScopeNames = [
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
];
const claudeCodeScopeNames = ["com.anthropic.claude_code.events"];

export const openTelemetryLogsRequestToTracesForCollection = async (
  otelLogs: DeepPartial<IExportLogsServiceRequest>
): Promise<TraceForCollection[]> => {
  return await tracer.withActiveSpan(
    "openTelemetryLogsRequestToTracesForCollection",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        if (!otelLogs.resourceLogs) {
          span.setAttribute("resourceLogs.count", 0);
          return [];
        }

        span.setAttribute("resourceLogs.count", otelLogs.resourceLogs.length);

        const traceMap: Record<string, TraceForCollection> = {};
        const generatedTraceId = generateOtelTraceId(); // Use this if no traceId is provided so we can still capture and group the logs together

        for (const resourceLog of otelLogs.resourceLogs) {
          if (!resourceLog?.scopeLogs) {
            continue;
          }

          for (const scopeLog of resourceLog.scopeLogs) {
            if (!scopeLog?.logRecords) {
              continue;
            }

            for (const logRecord of scopeLog.logRecords) {
              if (!logRecord) {
                continue;
              }
              if (!logRecord.body?.stringValue) {
                continue;
              }

              const traceId = logRecord.traceId
                ? decodeOpenTelemetryId(logRecord.traceId)
                : generatedTraceId;
              const spanId = logRecord.spanId
                ? decodeOpenTelemetryId(logRecord.spanId)
                : generateOtelSpanId();
              if (!traceId || !spanId) {
                logger.info("received log with no span or trace id, rejecting");
                continue;
              }

              let identifier = logRecord.body.stringValue;
              let input: SpanInputOutput | null = null;
              let output: SpanInputOutput | null = null;

              // Add defensive check for scopeLog and arrays
              const scopeName = scopeLog?.scope?.name ?? "";
              if (springAIScopeNames && Array.isArray(springAIScopeNames) && springAIScopeNames.includes(scopeName)) {
                const logString = logRecord.body.stringValue;
                const [springIdentifier, ...contentParts] =
                  logString.split("\n");
                identifier = springIdentifier ?? identifier;
                const content = contentParts.join("\n");

                if (!identifier || !content) {
                  logger.info(
                    "received log with no identifier or content, rejecting"
                  );
                  continue;
                }

                switch (identifier) {
                  case "Chat Model Completion:":
                    output = {
                      type: "text",
                      value: content,
                    };
                    break;

                  case "Chat Model Prompt Content:":
                    input = {
                      type: "text",
                      value: content,
                    };
                    break;

                  default:
                    continue;
                }
              }

              if (claudeCodeScopeNames && Array.isArray(claudeCodeScopeNames) && claudeCodeScopeNames.includes(scopeName)) {
                const promptAttribute = logRecord.attributes?.find(
                  (attribute) => attribute?.key === "prompt"
                );
                if (promptAttribute) {
                  input = {
                    type: "text",
                    value: promptAttribute.value?.stringValue ?? "",
                  };
                }
              }

              let trace = traceMap[traceId];
              if (!trace) {
                trace = {
                  traceId,
                  spans: [],
                  evaluations: [],
                  reservedTraceMetadata: {},
                  customMetadata: {},
                } satisfies TraceForCollection;
                traceMap[traceId] = trace;
              }

              let existingSpan = trace.spans.find(
                (span) => span.span_id === spanId
              );
              if (!existingSpan) {
                existingSpan = {
                  span_id: spanId,
                  trace_id: traceId,
                  name: identifier.replace(":", ""),
                  type: "llm",
                  input: input,
                  output: output,
                  params: otelAttributesToNestedAttributes(logRecord.attributes ?? []),
                  timestamps: {
                    ignore_timestamps_on_write: true,
                    started_at: convertFromUnixNano(logRecord.timeUnixNano),
                    finished_at: convertFromUnixNano(logRecord.timeUnixNano),
                  },
                };
                trace.spans.push(existingSpan);
              } else {
                // For log record spans, preserve existing input/output if they exist
                if (input && !existingSpan.input) {
                  existingSpan.input = input;
                }
                if (output && !existingSpan.output) {
                  existingSpan.output = output;
                }
                // Ensure the preserve flag is set
                if (!existingSpan.params) {
                  existingSpan.params = {};
                }
              }
            }
          }
        }
        const result = Object.values(traceMap);
        span.setAttribute("processed.traces.count", result.length);
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    }
  );
};

