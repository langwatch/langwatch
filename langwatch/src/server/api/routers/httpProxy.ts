import { JSONPath } from "jsonpath-plus";
import { z } from "zod";
import { createLogger } from "~/utils/logger/server";
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
 * - In production, blocks requests to localhost, private IPs, and cloud metadata endpoints
 * - In development, allows requests to hosts in ALLOWED_PROXY_HOSTS env var
 * - Always blocks cloud metadata endpoints (169.254.169.254, etc.) in all environments
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
        auth: z
          .object({
            type: z.enum(["none", "bearer", "api_key", "basic"]),
            token: z.string().optional(),
            headerName: z.string().optional(),
            apiKeyValue: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
          })
          .optional(),
        body: z.string(),
        outputPath: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ input, ctx }): Promise<HttpProxyResult> => {
      const { url, method, headers, auth, body, outputPath, agentId } = input;

      // Build request headers
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add custom headers (trim keys to prevent whitespace errors)
      if (headers) {
        for (const header of headers) {
          const key = header.key.trim();
          if (key) {
            requestHeaders[key] = header.value;
          }
        }
      }

      // Add auth headers
      if (auth) {
        switch (auth.type) {
          case "none":
            break;
          case "bearer":
            if (auth.token) {
              requestHeaders.Authorization = `Bearer ${auth.token}`;
            }
            break;
          case "api_key":
            if (auth.headerName && auth.apiKeyValue) {
              requestHeaders[auth.headerName] = auth.apiKeyValue;
            }
            break;
          case "basic":
            if (auth.username && auth.password) {
              const encoded = Buffer.from(
                `${auth.username}:${auth.password}`,
              ).toString("base64");
              requestHeaders.Authorization = `Basic ${encoded}`;
            }
            break;
          default: {
            const _exhaustive: never = auth.type;
            throw new Error(`Unknown auth type: ${_exhaustive}`);
          }
        }
      }

      // Generate trace IDs upfront so the traceparent header can be sent
      // with the outgoing request, enabling distributed tracing correlation
      const traceIds = agentId ? generateTraceIds() : undefined;

      if (traceIds) {
        requestHeaders.traceparent = buildTraceparentHeader(traceIds);
      }

      // Captures live requestHeaders (including auth) at call time.
      // Sanitization of credentials happens inside createAgentTestTrace.
      const maybeTrace = async (result: {
        success: boolean;
        response?: unknown;
        extractedOutput?: string;
        error?: string;
        status?: number;
        statusText?: string;
        duration?: number;
        responseHeaders?: Record<string, string>;
      }) => {
        if (!agentId) return;

        const customAuthHeaderName =
          auth?.type === "api_key" ? auth.headerName : undefined;

        try {
          await createAgentTestTrace({
            projectId: input.projectId,
            agentId,
            userId: ctx.session.user.id,
            traceId: traceIds?.traceId,
            spanId: traceIds?.spanId,
            testContext: buildTraceTestContext({
              url,
              method,
              auth,
              outputPath,
            }),
            requestBody: body,
            requestHeaders,
            customAuthHeaderName,
            result,
          });
        } catch (traceError) {
          // Tracing failures must not break the HTTP proxy response
          _logger.error({ traceError }, "failed to create agent test trace");
        }
      };

      try {
        // Parse body to validate JSON
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          const error = "Invalid JSON in request body";
          await maybeTrace({ success: false, error });
          return { success: false, error };
        }

        // Make the HTTP request with SSRF protection
        // Uses atomic validate-and-fetch to eliminate TOCTOU DNS rebinding
        const startTime = Date.now();
        let response;
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
          await maybeTrace({ success: false, error });
          return { success: false, error };
        }
        const duration = Date.now() - startTime;

        // Parse response
        let responseData: unknown;
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }

        // Capture response headers
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Extract output if path provided
        let extractedOutput: string | undefined;
        if (outputPath?.trim() && responseData) {
          try {
            const result = JSONPath({ path: outputPath, json: responseData });
            if (result && result.length > 0) {
              extractedOutput =
                typeof result[0] === "string"
                  ? result[0]
                  : JSON.stringify(result[0]);
            }
          } catch {
            // JSONPath extraction failed, leave extractedOutput undefined
          }
        }

        if (!response.ok) {
          const httpErrorResult = {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            response: responseData,
            status: response.status,
            statusText: response.statusText,
            duration,
            responseHeaders,
          };
          await maybeTrace(httpErrorResult);
          return httpErrorResult;
        }

        const successResult = {
          success: true,
          response: responseData,
          extractedOutput,
          status: response.status,
          statusText: response.statusText,
          duration,
          responseHeaders,
        };
        await maybeTrace(successResult);
        return successResult;
      } catch (err) {
        const error = err instanceof Error ? err.message : "Request failed";
        await maybeTrace({ success: false, error });
        return { success: false, error };
      }
    }),
});
