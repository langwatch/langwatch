/**
 * The trace one HTTP agent test writes, and the redaction that decides what of
 * it is safe to keep.
 *
 * When somebody tests an HTTP agent the platform records the exchange so the
 * agent's test history can show it. That record is durable and queryable, so
 * the credential handling here is the whole point of the module rather than a
 * detail of it: what a person types on the Auth tab, and what they type on the
 * Headers tab, both have to come out of the stored request.
 *
 * The span is built here and handed to the process to ingest — the OTLP
 * conversion and the collector are not this feature's.
 */
import crypto from "node:crypto";
import type { CustomMetadata, Span } from "@langwatch/trace-contract";

type AuthInput = {
  type: "none" | "bearer" | "api_key" | "basic";
  token?: string;
  headerName?: string;
  apiKeyValue?: string;
  username?: string;
  password?: string;
};

export type TraceTestContext = {
  url: string;
  method: string;
  has_auth: boolean;
  output_path?: string;
};

/**
 * Header names whose value is a credential often enough that keeping it is not
 * worth the one case where reading it would have helped.
 *
 * The Auth tab is not the only way a token reaches a request: an author who
 * types `X-API-Key: sk-live-…` on the Headers tab has configured a credential
 * the auth-aware redaction below knows nothing about, and trace storage is not
 * where it should end up. Names are kept either way, so the trace still shows
 * which headers the request carried.
 */
const CREDENTIAL_HEADER_WORD =
  /(^|[-_])(authorization|auth|cookie2?|api[-_]?key|token|secret|password|credential)s?([-_]|$)/i;

const REDACTED = "[REDACTED]";

/**
 * Sanitizes request headers for trace storage by redacting credential values.
 *
 * Whole words, so `X-Auth-Token` and `X-Amz-Security-Token` lose their values
 * while `X-Api-Version`, `X-Idempotency-Key` and `WWW-Authenticate` keep
 * theirs: half the value of recording headers is the ones somebody came to
 * read. `Authorization` keeps its scheme, since "the Bearer token was wrong"
 * and "no credential was sent at all" are different bugs and the trace should
 * be able to tell them apart.
 *
 * Erring towards redaction: a header whose name reads like a credential is
 * treated as one, because the cost of hiding an obscure version string is a
 * question, and the cost of storing a live token is an incident.
 */
export function sanitizeHeadersForTrace({
  headers,
  customAuthHeaderName,
}: {
  headers: Record<string, string>;
  /** The header the agent's api_key auth is configured to send under. */
  customAuthHeaderName?: string;
}): Record<string, string> {
  const sanitized = { ...headers };
  const customLower = customAuthHeaderName?.toLowerCase();

  for (const key of Object.keys(sanitized)) {
    const lower = key.toLowerCase();

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

/** One agent test, as a span and the metadata that says which agent it was. */
export type AgentTestTrace = Readonly<{
  traceId: string;
  span: Span;
  customMetadata: CustomMetadata;
  userId: string;
  /** Epoch ms the test finished, which is when the span is recorded. */
  occurredAt: number;
}>;

/**
 * Builds the span for one HTTP agent test execution.
 *
 * Ingestion is the process's — this only decides what the record says, which
 * includes running every request header through `sanitizeHeadersForTrace`
 * before it can reach storage.
 */
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
  now = Date.now(),
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
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.response !== undefined ? { body: result.response } : {}),
    ...(result.extractedOutput !== undefined ? { extracted_output: result.extractedOutput } : {}),
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
