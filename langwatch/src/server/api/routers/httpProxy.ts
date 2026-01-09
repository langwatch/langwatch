import { z } from "zod";
import { JSONPath } from "jsonpath-plus";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * HTTP Proxy Router
 *
 * Server-side HTTP client for executing requests with:
 * - Auth token security (kept server-side)
 * - CORS bypass
 * - JSONPath output extraction
 *
 * Used by:
 * - HTTP agent preview in drawer
 * - Workflow/simulation HTTP component execution
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

      // Add custom headers
      if (headers) {
        for (const header of headers) {
          requestHeaders[header.key] = header.value;
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
            duration,
          };
        }

        return {
          success: true,
          response: responseData,
          extractedOutput,
          duration,
          status: response.status,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Request failed",
        };
      }
    }),
});
