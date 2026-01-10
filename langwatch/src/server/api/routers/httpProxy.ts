import { z } from "zod";
import { JSONPath } from "jsonpath-plus";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createLogger } from "~/utils/logger";
import { validateUrlForSSRF } from "~/utils/ssrfProtection";

const logger = createLogger("langwatch:httpProxy");

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
      })
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ input }) => {
      const { url, method, headers, auth, body, outputPath } = input;

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
              requestHeaders["Authorization"] = `Bearer ${auth.token}`;
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
                `${auth.username}:${auth.password}`
              ).toString("base64");
              requestHeaders["Authorization"] = `Basic ${encoded}`;
            }
            break;
          default: {
            const _exhaustive: never = auth.type;
            throw new Error(`Unknown auth type: ${_exhaustive}`);
          }
        }
      }

      try {
        // Parse body to validate JSON
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          return {
            success: false,
            error: "Invalid JSON in request body",
          };
        }

        // Validate URL for SSRF protection
        try {
          await validateUrlForSSRF(url);
        } catch (ssrfError) {
          return {
            success: false,
            error: ssrfError instanceof Error ? ssrfError.message : "URL validation failed",
          };
        }

        // Make the HTTP request
        const startTime = Date.now();
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: method !== "GET" ? JSON.stringify(parsedBody) : undefined,
        });
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
        if (outputPath && outputPath.trim() && responseData) {
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
        return {
          success: false,
          error: err instanceof Error ? err.message : "Request failed",
        };
      }
    }),
});
