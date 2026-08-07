import { createLogger } from "@langwatch/observability";
import { JSONPath } from "jsonpath-plus";
import { z } from "zod";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  buildTraceparentHeader,
  buildTraceTestContext,
  createAgentTestTrace,
  generateTraceIds,
} from "./httpProxyTracing";

const _logger = createLogger("langwatch:httpProxy");

type HttpProxyResult = {
  success: boolean;
  error?: string;
  response?: unknown;
  extractedOutput?: string;
  status?: number;
  statusText?: string;
  duration?: number;
  responseHeaders?: Record<string, string>;
};

const httpProxyAuthSchema = z.object({
  type: z.enum(["none", "bearer", "api_key", "basic"]),
  token: z.string().optional(),
  headerName: z.string().optional(),
  apiKeyValue: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});
type HttpProxyAuth = z.infer<typeof httpProxyAuthSchema>;

// Auth headers for the outgoing request. Never mutates the caller's headers.
function buildAuthHeaders(
  auth: HttpProxyAuth | undefined,
): Record<string, string> {
  if (!auth) return {};

  switch (auth.type) {
    case "none":
      return {};
    case "bearer":
      return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
    case "api_key":
      return auth.headerName && auth.apiKeyValue
        ? { [auth.headerName]: auth.apiKeyValue }
        : {};
    case "basic": {
      if (!auth.username || !auth.password) return {};
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString(
        "base64",
      );
      return { Authorization: `Basic ${encoded}` };
    }
    default: {
      const _exhaustive: never = auth.type;
      throw new Error(`Unknown auth type: ${_exhaustive}`);
    }
  }
}

// Custom headers (trimmed keys) + auth headers + an optional traceparent for
// distributed tracing correlation with the outgoing request.
function buildProxyRequestHeaders({
  headers,
  auth,
  traceparent,
}: {
  headers: { key: string; value: string }[] | undefined;
  auth: HttpProxyAuth | undefined;
  traceparent: string | undefined;
}): Record<string, string> {
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (headers) {
    for (const header of headers) {
      const key = header.key.trim();
      if (key) {
        requestHeaders[key] = header.value;
      }
    }
  }

  Object.assign(requestHeaders, buildAuthHeaders(auth));

  if (traceparent) {
    requestHeaders.traceparent = traceparent;
  }

  return requestHeaders;
}

// Captures live requestHeaders (including auth) at call time. Sanitization
// of credentials happens inside createAgentTestTrace. Tracing failures must
// not break the HTTP proxy response, so any error here is only logged.
async function traceHttpProxyResult({
  agentId,
  projectId,
  userId,
  traceIds,
  url,
  method,
  auth,
  outputPath,
  body,
  requestHeaders,
  result,
}: {
  agentId: string | undefined;
  projectId: string;
  userId: string;
  traceIds: { traceId: string; spanId: string } | undefined;
  url: string;
  method: string;
  auth: HttpProxyAuth | undefined;
  outputPath: string | undefined;
  body: string;
  requestHeaders: Record<string, string>;
  result: Parameters<typeof createAgentTestTrace>[0]["result"];
}): Promise<void> {
  if (!agentId) return;

  const customAuthHeaderName =
    auth?.type === "api_key" ? auth.headerName : undefined;

  try {
    await createAgentTestTrace({
      projectId,
      agentId,
      userId,
      traceId: traceIds?.traceId,
      spanId: traceIds?.spanId,
      testContext: buildTraceTestContext({ url, method, auth, outputPath }),
      requestBody: body,
      requestHeaders,
      customAuthHeaderName,
      result,
    });
  } catch (traceError) {
    _logger.error({ traceError }, "failed to create agent test trace");
  }
}

// Extracts a JSONPath-selected value from the response body. Returns
// undefined on a missing path, no match, or an invalid expression.
function extractJsonPathOutput({
  outputPath,
  responseData,
}: {
  outputPath: string | undefined;
  responseData: unknown;
}): string | undefined {
  if (!outputPath?.trim() || !responseData) return undefined;
  try {
    const result = JSONPath({ path: outputPath, json: responseData });
    if (!result || result.length === 0) return undefined;
    return typeof result[0] === "string"
      ? result[0]
      : JSON.stringify(result[0]);
  } catch {
    return undefined;
  }
}

async function readProxyResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  return contentType?.includes("application/json")
    ? await response.json()
    : await response.text();
}

function captureProxyResponseHeaders(
  response: Response,
): Record<string, string> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return responseHeaders;
}

// Validates the body, makes the SSRF-safe request, and shapes the result —
// never throws; every failure mode (bad JSON, blocked URL, or anything else)
// resolves to an `HttpProxyResult` with `success: false` so the caller can
// trace and return it uniformly.
async function performProxyRequest({
  url,
  method,
  body,
  requestHeaders,
  outputPath,
}: {
  url: string;
  method: string;
  body: string;
  requestHeaders: Record<string, string>;
  outputPath: string | undefined;
}): Promise<HttpProxyResult> {
  try {
    // Parse body to validate JSON
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      return { success: false, error: "Invalid JSON in request body" };
    }

    // Make the HTTP request with SSRF protection
    // Uses atomic validate-and-fetch to eliminate TOCTOU DNS rebinding
    const startTime = Date.now();
    let response: Response;
    try {
      response = await ssrfSafeFetch(url, {
        method,
        headers: requestHeaders,
        body: method !== "GET" ? JSON.stringify(parsedBody) : undefined,
      });
    } catch (ssrfError) {
      const error =
        ssrfError instanceof Error
          ? ssrfError.message
          : "URL validation failed";
      return { success: false, error };
    }
    const duration = Date.now() - startTime;

    const responseData = await readProxyResponseBody(response);
    const responseHeaders = captureProxyResponseHeaders(response);
    const extractedOutput = extractJsonPathOutput({ outputPath, responseData });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        response: responseData,
        status: response.status,
        statusText: response.statusText,
        duration,
        responseHeaders,
      };
    }

    return {
      success: true,
      response: responseData,
      extractedOutput,
      status: response.status,
      statusText: response.statusText,
      duration,
      responseHeaders,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Request failed";
    return { success: false, error };
  }
}

/**
 * HTTP Proxy Router
 *
 * Server-side HTTP client for executing requests with:
 * - Auth token security (kept server-side)
 * - CORS bypass
 * - JSONPath output extraction
 * - SSRF protection (blocks private IPs, localhost, metadata endpoints)
 *
 * Used by:
 * - HTTP agent preview in drawer
 * - Workflow/simulation HTTP component execution
 *
 * Security:
 * - When BLOCK_LOCAL_HTTP_CALLS is on, blocks requests to localhost, private IPs, and cloud metadata endpoints
 * - When BLOCK_LOCAL_HTTP_CALLS is on, allows requests to hosts in ALLOWED_PROXY_HOSTS env var
 * - Always blocks cloud metadata endpoints (169.254.169.254, etc.) regardless of toggle
 */
export const httpProxyRouter = createTRPCRouter({
  /**
   * Executes an HTTP request with authentication and extracts output via JSONPath
   */
  execute: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentId: z.string().optional(),
        url: z.string().url(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        headers: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        auth: httpProxyAuthSchema.optional(),
        body: z.string(),
        outputPath: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ input, ctx }): Promise<HttpProxyResult> => {
      const { url, method, headers, auth, body, outputPath, agentId } = input;

      // Generate trace IDs upfront so the traceparent header can be sent
      // with the outgoing request, enabling distributed tracing correlation
      const traceIds = agentId ? generateTraceIds() : undefined;
      const requestHeaders = buildProxyRequestHeaders({
        headers,
        auth,
        traceparent: traceIds ? buildTraceparentHeader(traceIds) : undefined,
      });

      const result = await performProxyRequest({
        url,
        method,
        body,
        requestHeaders,
        outputPath,
      });

      // Sanitization of credentials happens inside createAgentTestTrace.
      // Tracing failures must not break the HTTP proxy response.
      await traceHttpProxyResult({
        agentId,
        projectId: input.projectId,
        userId: ctx.session.user.id,
        traceIds,
        url,
        method,
        auth,
        outputPath,
        body,
        requestHeaders,
        result,
      });

      return result;
    }),
});
