import { createHash } from "node:crypto";

import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
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

/**
 * Claude Code 2.1.x emits its OTLP logs with NO trace context — the
 * standard exporter does not carry a current span when these fire
 * since the cost-bearing api_request events are not wrapped in one.
 * Without a trace_id+span_id the receiver writes empty-id rows and
 * the fold projection skips them, so /me/traces shows nothing.
 *
 * Synthesizing stable ids from the event's own correlation keys
 * (session.id groups every turn into one trace; prompt.id +
 * event.name + event.sequence make each event a distinct row) lets
 * the existing fold + I/O extractors do their job unchanged.
 */
const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * Codex's instrumentation scope varies across builds (codex 0.131
 * uses `codex_exec`, 0.13x sometimes just `codex`), so the
 * synthesizer below gates on the event.name prefix (`codex.*`)
 * which is stable across versions.
 */
const CODEX_EVENT_NAME_PREFIX = "codex.";

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
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.traceId as string | Uint8Array,
                    ) ?? ""
                  : "";
                const wireSpanId = logRecord.spanId
                  ? TraceRequestUtils.normalizeOtlpId(
                      logRecord.spanId as string | Uint8Array,
                    ) ?? ""
                  : "";

                const logAttrs = normalizeOtlpAttributeMap(
                  logRecord.attributes,
                );
                const claudeIds = synthesizeClaudeCodeIdsIfMissing({
                  scopeName,
                  wireTraceId,
                  wireSpanId,
                  attrs: logAttrs,
                });
                const { traceId, spanId } = synthesizeCodexIdsIfMissing({
                  wireTraceId: claudeIds.traceId,
                  wireSpanId: claudeIds.spanId,
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

        span.setAttribute("logs.ingestion.successes", collectedCount);
        span.setAttribute("logs.ingestion.drops", droppedCount);
        span.setAttribute("logs.ingestion.failures", failedCount);
      },
    );
  }
}

/**
 * Synthesize trace_id + span_id for claude_code log records that
 * arrive without trace context (the normal case — Claude Code 2.1.x
 * emits its api_request / user_prompt events outside any active
 * span). Returns the wire ids unchanged for any other scope, or when
 * the wire ids ARE present.
 *
 * Stability contract:
 *   - trace_id = sha256(session.id) truncated to 32 hex.
 *     Every turn of a single Claude Code session collapses into
 *     one trace row — matches the /me/traces UX user expects.
 *   - span_id = sha256(session.id || ':' || prompt.id || ':' ||
 *     event.name || ':' || event.sequence) truncated to 16 hex.
 *     Each event (user_prompt + api_request + tool_decision + …)
 *     becomes its own log row under that trace, idempotent under
 *     re-ingest through the stored_log_records ReplacingMergeTree.
 *
 * When session.id is missing we leave the ids empty rather than
 * inventing them — the record still lands in stored_log_records
 * with empty trace context (the c56eced2d behavior), and a future
 * caller with session.id will get correlated correctly.
 */
function synthesizeClaudeCodeIdsIfMissing(args: {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  attrs: Record<string, string>;
}): { traceId: string; spanId: string } {
  const { scopeName, wireTraceId, wireSpanId, attrs } = args;
  if (scopeName !== CLAUDE_CODE_EVENT_SCOPE) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  if (wireTraceId && wireSpanId) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  const sessionId = attrs["session.id"];
  if (!sessionId) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  const promptId = attrs["prompt.id"] ?? "";
  const eventName = attrs["event.name"] ?? "";
  const eventSequence = attrs["event.sequence"] ?? "";
  const traceId = wireTraceId
    ? wireTraceId
    : createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  const spanId = wireSpanId
    ? wireSpanId
    : createHash("sha256")
        .update(`${sessionId}:${promptId}:${eventName}:${eventSequence}`)
        .digest("hex")
        .slice(0, 16);
  return { traceId, spanId };
}

/**
 * Codex equivalent of synthesizeClaudeCodeIdsIfMissing. Codex emits
 * its events (codex.user_prompt / codex.sse_event /
 * codex.conversation_starts) under a `conversation.id` that groups
 * a multi-turn chat into one trace. Each event gets its own span id
 * derived from (conversation.id, event.name, event.sequence) so the
 * fold sees them as distinct rows under the same trace.
 *
 * Scope-agnostic by design: codex's instrumentation scope varies
 * (`codex_exec` in 0.131, `codex` in 0.13x). We gate on the
 * event.name prefix instead, which is stable.
 */
function synthesizeCodexIdsIfMissing(args: {
  wireTraceId: string;
  wireSpanId: string;
  attrs: Record<string, string>;
}): { traceId: string; spanId: string } {
  const { wireTraceId, wireSpanId, attrs } = args;
  if (wireTraceId && wireSpanId) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  const eventName = attrs["event.name"] ?? "";
  if (!eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  const conversationId = attrs["conversation.id"];
  if (!conversationId) {
    return { traceId: wireTraceId, spanId: wireSpanId };
  }
  const eventSequence = attrs["event.sequence"] ?? "";
  const traceId = wireTraceId
    ? wireTraceId
    : createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  const spanId = wireSpanId
    ? wireSpanId
    : createHash("sha256")
        .update(`${conversationId}:${eventName}:${eventSequence}`)
        .digest("hex")
        .slice(0, 16);
  return { traceId, spanId };
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
