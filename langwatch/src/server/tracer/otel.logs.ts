import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "~/utils/types";
import { generateOtelSpanId, generateOtelTraceId } from "../../utils/trace";
import {
  otelAttributesToNestedAttributes,
  type TraceForCollection,
} from "./otel.traces";
import type { SpanInputOutput, SpanMetrics } from "./types";
import {
  convertFromUnixNano,
  decodeBase64OpenTelemetryId,
  decodeOpenTelemetryId,
} from "./utils";

const logger = createLogger("langwatch.tracer.otel.logs");
const tracer = getLangWatchTracer("langwatch.tracer.otel.logs");

const springAIScopeNames = [
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
];
const claudeCodeScopeNames = ["com.anthropic.claude_code.events"];

export const openTelemetryLogsRequestToTracesForCollection = async (
  otelLogs: DeepPartial<IExportLogsServiceRequest>,
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
                ? typeof logRecord.traceId === "string"
                  ? decodeBase64OpenTelemetryId(logRecord.traceId)
                  : decodeOpenTelemetryId(logRecord.traceId)
                : generatedTraceId;
              const spanId = logRecord.spanId
                ? typeof logRecord.spanId === "string"
                  ? decodeBase64OpenTelemetryId(logRecord.spanId)
                  : decodeOpenTelemetryId(logRecord.spanId)
                : generateOtelSpanId();
              if (!traceId || !spanId) {
                logger.info("received log with no span or trace id, rejecting");
                continue;
              }

              let identifier = logRecord.body.stringValue;
              let input: SpanInputOutput | null = null;
              let output: SpanInputOutput | null = null;
              let model: string | null = null;
              let metrics: SpanMetrics | null = null;

              if (springAIScopeNames.includes(scopeLog.scope?.name ?? "")) {
                const logString = logRecord.body.stringValue;
                const [springIdentifier, ...contentParts] =
                  logString.split("\n");
                identifier = springIdentifier ?? identifier;
                const content = contentParts.join("\n");

                if (!identifier || !content) {
                  logger.info(
                    "received log with no identifier or content, rejecting",
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

              if (claudeCodeScopeNames.includes(scopeLog.scope?.name ?? "")) {
                const attrs = logRecord.attributes ?? [];
                const attrValue = (key: string) =>
                  attrs.find((attribute) => attribute?.key === key)?.value;
                const attrNumber = (key: string): number | null => {
                  const v = attrValue(key);
                  if (!v) return null;
                  const raw =
                    v.stringValue ??
                    (v.intValue as string | number | undefined) ??
                    v.doubleValue;
                  const n =
                    typeof raw === "string"
                      ? Number(raw)
                      : typeof raw === "number"
                        ? raw
                        : NaN;
                  return Number.isFinite(n) ? n : null;
                };

                const promptValue = attrValue("prompt");
                if (promptValue) {
                  input = {
                    type: "text",
                    value: promptValue.stringValue ?? "",
                  };
                }

                // Claude Code emits one `claude_code.api_request` log record
                // per model call carrying cost + tokens + model directly on
                // its attributes (no OTTL on this personal-binding path).
                // Lift them onto the span so the trace itself shows
                // gen_ai-style cost/usage, matching what the OTTL ingestion
                // path produces for the org governance feed.
                const isApiRequest =
                  attrValue("event.name")?.stringValue === "api_request" ||
                  logRecord.body.stringValue === "claude_code.api_request";
                if (isApiRequest) {
                  model = attrValue("model")?.stringValue ?? null;
                  const cost = attrNumber("cost_usd");
                  const promptTokens = attrNumber("input_tokens");
                  const completionTokens = attrNumber("output_tokens");
                  const cacheRead = attrNumber("cache_read_tokens");
                  const cacheCreation = attrNumber("cache_creation_tokens");
                  const next: SpanMetrics = {};
                  if (cost !== null) next.cost = cost;
                  if (promptTokens !== null) next.prompt_tokens = promptTokens;
                  if (completionTokens !== null)
                    next.completion_tokens = completionTokens;
                  if (cacheRead !== null) next.cache_read_input_tokens = cacheRead;
                  if (cacheCreation !== null)
                    next.cache_creation_input_tokens = cacheCreation;
                  if (Object.keys(next).length > 0) metrics = next;
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
                (span) => span.span_id === spanId,
              );
              if (!existingSpan) {
                existingSpan = {
                  span_id: spanId,
                  trace_id: traceId,
                  name: identifier.replace(":", ""),
                  type: "llm",
                  input: input,
                  output: output,
                  ...(model ? { model } : {}),
                  ...(metrics ? { metrics } : {}),
                  params: otelAttributesToNestedAttributes(
                    logRecord.attributes ?? [],
                  ),
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
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    },
  );
};
