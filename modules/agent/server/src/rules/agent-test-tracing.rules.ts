import crypto from "node:crypto";
import type { HttpAuth } from "@langwatch/agent-contract";
import type { CustomMetadata, Span } from "@langwatch/trace-contract";
import { nowInstant } from "@langwatch/time";

export type TraceTestContext = {
  url: string;
  method: string;
  has_auth: boolean;
  output_path?: string;
};

// Match credential words without hiding ordinary headers such as X-Api-Version.
const CREDENTIAL_HEADER_WORD =
  /(^|[-_])(authorization|auth|cookie2?|api[-_]?key|token|secret|password|credential)s?([-_]|$)/i;

const REDACTED = "[REDACTED]";

/** Retain header names and authorization schemes, but never their credential values. */
export function sanitizeHeadersForTrace({
  headers,
  customAuthHeaderName,
}: {
  headers: Record<string, string>;
  /** The header the agent's api_key auth is configured to send under. */
  customAuthHeaderName?: string;
}): Record<string, string> {
  const sanitized = { ...headers };
  const customLower = customAuthHeaderName?.trim().toLowerCase();

  for (const key of Object.keys(sanitized)) {
    const lower = key.trim().toLowerCase();

    if (lower === "authorization") {
      const [scheme, ...rest] = sanitized[key]!.split(" ");
      sanitized[key] = rest.length > 0 ? `${scheme} ${REDACTED}` : REDACTED;
      continue;
    }

    if (lower === customLower || CREDENTIAL_HEADER_WORD.test(lower)) {
      sanitized[key] = REDACTED;
    }
  }

  return sanitized;
}

export function buildTraceTestContext({
  url,
  method,
  auth,
  outputPath,
}: {
  url: string;
  method: string;
  auth?: HttpAuth;
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

export function generateTraceIds() {
  return {
    traceId: crypto.randomBytes(16).toString("hex"),
    spanId: crypto.randomBytes(8).toString("hex"),
  };
}

export function buildTraceparentHeader({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}): string {
  return `00-${traceId}-${spanId}-01`;
}

/** One agent test, as a span and the metadata that says which agent it was. */
export type AgentTestTrace = Readonly<{
  traceId: string;
  span: Span;
  customMetadata: CustomMetadata;
  userId: string;
  /** Epoch ms the test finished, which is when the span is recorded. */
  occurredAt: number;
}>;

export function buildAgentTestTrace({
  agentId,
  userId,
  traceId: providedTraceId,
  spanId: providedSpanId,
  testContext,
  requestBody,
  requestHeaders,
  customAuthHeaderName,
  result,
  now = nowInstant().epochMilliseconds,
}: {
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
  now?: number;
}): AgentTestTrace {
  const generated = generateTraceIds();
  const traceId = providedTraceId ?? generated.traceId;
  const spanId = providedSpanId ?? generated.spanId;

  const sanitizedHeaders = sanitizeHeadersForTrace({
    headers: requestHeaders,
    customAuthHeaderName,
  });

  const inputValue = {
    url: testContext.url,
    method: testContext.method,
    headers: sanitizedHeaders,
    body: requestBody,
    ...(testContext.output_path ? { output_path: testContext.output_path } : {}),
  };

  const outputValue = {
    ...(result.status !== void 0 ? { status: result.status } : {}),
    ...(result.response !== void 0 ? { body: result.response } : {}),
    ...(result.extractedOutput !== void 0 ? { extracted_output: result.extractedOutput } : {}),
    ...(result.error ? { error: result.error } : {}),
  };

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
      has_auth: testContext.has_auth,
      ...(testContext.output_path ? { output_path: testContext.output_path } : {}),
    },
  };

  return { traceId, span, customMetadata, userId, occurredAt: now };
}
