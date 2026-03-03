/**
 * HTTP Agent Test Tracing
 *
 * Provides trace creation and auth sanitization for HTTP agent test executions.
 * When a user tests an HTTP agent, this module creates a trace capturing
 * request/response details while redacting sensitive auth credentials.
 */
import crypto from "node:crypto";
import type { Span, CustomMetadata } from "../../tracer/types";
import { scheduleTraceCollectionWithFallback } from "../../background/workers/collectorWorker";

type AuthInput = {
  type: "none" | "bearer" | "api_key" | "basic";
  token?: string;
  headerName?: string;
  apiKeyValue?: string;
  username?: string;
  password?: string;
};

type TraceTestContext = {
  url: string;
  method: string;
  has_auth: boolean;
  output_path?: string;
};

/**
 * Sanitizes request headers for trace storage by redacting auth-related values.
 *
 * Redacts:
 * - Authorization header values (Bearer, Basic, etc.)
 * - Custom auth header values (e.g., X-API-Key) when headerName is specified
 */
export function sanitizeHeadersForTrace(
  headers: Record<string, string>,
  customAuthHeaderName?: string,
): Record<string, string> {
  const sanitized = { ...headers };

  if (sanitized.Authorization) {
    const parts = sanitized.Authorization.split(" ");
    if (parts.length >= 2) {
      sanitized.Authorization = `${parts[0]} [REDACTED]`;
    } else {
      sanitized.Authorization = "[REDACTED]";
    }
  }

  if (customAuthHeaderName && sanitized[customAuthHeaderName]) {
    sanitized[customAuthHeaderName] = "[REDACTED]";
  }

  return sanitized;
}

/**
 * Builds the test_context metadata for an HTTP agent test trace.
 * Includes request details but never includes auth credential values.
 */
export function buildTraceTestContext({
  url,
  method,
  auth,
  outputPath,
}: {
  url: string;
  method: string;
  auth?: AuthInput;
  outputPath?: string;
}): TraceTestContext {
  const hasAuth = !!auth && auth.type !== "none";

  return {
    url,
    method,
    has_auth: hasAuth,
    ...(outputPath ? { output_path: outputPath } : {}),
  };
}

/**
 * Generates a W3C-compatible trace ID (32 hex chars) and span ID (16 hex chars).
 */
export function generateTraceIds() {
  return {
    traceId: crypto.randomBytes(16).toString("hex"),
    spanId: crypto.randomBytes(8).toString("hex"),
  };
}

/**
 * Builds a W3C traceparent header value for distributed tracing.
 * Format: {version}-{traceId}-{spanId}-{flags}
 */
export function buildTraceparentHeader({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): string {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Creates a trace for an HTTP agent test execution and submits it to the collector.
 */
export async function createAgentTestTrace({
  projectId,
  agentId,
  userId,
  traceId: providedTraceId,
  spanId: providedSpanId,
  testContext,
  requestBody,
  requestHeaders,
  customAuthHeaderName,
  result,
}: {
  projectId: string;
  agentId: string;
  userId: string;
  traceId?: string;
  spanId?: string;
  testContext: TraceTestContext;
  requestBody: string;
  requestHeaders: Record<string, string>;
  customAuthHeaderName?: string;
  result: {
    success: boolean;
    response?: unknown;
    extractedOutput?: string;
    error?: string;
    status?: number;
    statusText?: string;
    duration?: number;
    responseHeaders?: Record<string, string>;
  };
}) {
  const now = Date.now();
  const generated = generateTraceIds();
  const traceId = providedTraceId ?? generated.traceId;
  const spanId = providedSpanId ?? generated.spanId;

  const sanitizedHeaders = sanitizeHeadersForTrace(
    requestHeaders,
    customAuthHeaderName,
  );

  const inputValue = {
    url: testContext.url,
    method: testContext.method,
    headers: sanitizedHeaders,
    body: requestBody,
    ...(testContext.output_path
      ? { output_path: testContext.output_path }
      : {}),
  };

  const outputValue = result.success
    ? {
        status: result.status,
        body: result.response,
        ...(result.extractedOutput
          ? { extracted_output: result.extractedOutput }
          : {}),
      }
    : { error: result.error };

  const span: Span = {
    span_id: spanId,
    trace_id: traceId,
    type: "span",
    name: `HTTP ${testContext.method} ${testContext.url}`,
    input: { type: "json", value: inputValue },
    output: { type: "json", value: outputValue },
    error: result.success
      ? null
      : {
          has_error: true,
          message: result.error ?? "Request failed",
          stacktrace: [],
        },
    timestamps: {
      started_at: now - (result.duration ?? 0),
      finished_at: now,
    },
  };

  const customMetadata: CustomMetadata = {
    type: "agent_test",
    agent_id: agentId,
    test_context: {
      url: testContext.url,
      method: testContext.method,
      has_auth: String(testContext.has_auth),
      ...(testContext.output_path
        ? { output_path: testContext.output_path }
        : {}),
    },
  };

  await scheduleTraceCollectionWithFallback(
    {
      projectId,
      traceId,
      spans: [span],
      evaluations: undefined,
      reservedTraceMetadata: {
        user_id: userId,
      },
      customMetadata,
      expectedOutput: null,
      existingTrace: undefined,
      paramsMD5: crypto
        .createHash("md5")
        .update(JSON.stringify({ traceId, span, customMetadata }))
        .digest("hex"),
      collectedAt: now,
    },
    false,
  );

  return { traceId };
}
