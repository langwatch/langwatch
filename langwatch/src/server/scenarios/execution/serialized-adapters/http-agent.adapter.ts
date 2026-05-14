/**
 * Serialized HTTP agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { JSONPath } from "jsonpath-plus";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../../adapters/auth.strategies";
import {
  buildTemplateContext,
  renderBodyTemplate,
  renderUrlTemplate,
} from "../http-template-engine";
import { injectTraceContextHeaders } from "../trace-context-headers";
import type { HttpAgentData } from "../types";
import { createChildProcessLogger } from "../child-logger";
import type { Logger } from "~/utils/logger/server";

/**
 * Truncate a response body for log inclusion. Long bodies are useless in
 * CloudWatch and explode log volume; the prefix is enough to spot the
 * upstream's failure mode.
 */
const RESPONSE_BODY_PREVIEW_CHARS = 512;

function previewResponseBody(body: string): string {
  if (body.length <= RESPONSE_BODY_PREVIEW_CHARS) {
    return body;
  }
  return `${body.slice(0, RESPONSE_BODY_PREVIEW_CHARS)}…`;
}

/**
 * Strip query string before logging. URL templates can interpolate
 * user-supplied secrets (?api_key=…, ?access_token=…) and CloudWatch
 * persists every log line — drop the query so credentials don't leak.
 */
function redactUrlForLogs(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Header names (lowercase) whose values must be redacted in logs and errors. */
const SENSITIVE_HEADERS = new Set(["authorization", "x-api-key"]);

/** Maximum body length to include in error messages before truncating. */
const ERROR_BODY_LIMIT_CHARS = 2048;

function previewErrorBody(body: string): string {
  if (body.length <= ERROR_BODY_LIMIT_CHARS) {
    return body;
  }
  return `${body.slice(0, ERROR_BODY_LIMIT_CHARS)}... [truncated]`;
}

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? "[REDACTED]"
      : value;
  }
  return redacted;
}

/**
 * Pick the upstream request id (first match wins). Different upstreams use
 * different header conventions — surface whichever the target chose.
 */
function pickUpstreamRequestId(
  headers: { get(name: string): string | null },
): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-amzn-requestid") ??
    headers.get("x-n8n-execution-id") ??
    undefined
  );
}

/**
 * Serialized HTTP agent adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedHttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly config: HttpAgentData;
  private readonly logger: Logger;
  private capturedTraceId: string | undefined;

  constructor(config: HttpAgentData, logger?: Logger) {
    super();
    this.name = "SerializedHttpAgentAdapter";
    this.config = config;
    this.logger =
      logger ?? createChildProcessLogger("langwatch:scenarios:http-adapter");
  }

  /** Returns the trace ID captured during the most recent HTTP request. */
  getTraceId(): string | undefined {
    return this.capturedTraceId;
  }

  async call(input: AgentInput): Promise<string> {
    const templateContext = buildTemplateContext({
      input,
      scenarioMappings: this.config.scenarioMappings,
    });
    const url = this.buildUrl(templateContext);
    const headers = this.buildRequestHeaders();
    const body = this.buildRequestBody(input, templateContext);
    const responseData = await this.executeHttpRequest(url, headers, body);
    return this.extractResponseContent(responseData);
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    for (const header of this.config.headers) {
      const key = header.key.trim();
      if (key) {
        headers[key] = header.value;
      }
    }

    Object.assign(headers, applyAuthentication(this.config.auth));

    const { traceId } = injectTraceContextHeaders({ headers });
    this.capturedTraceId = traceId;

    return headers;
  }

  private buildUrl(context: Record<string, unknown>): string {
    return renderUrlTemplate({ template: this.config.url, context });
  }

  private async executeHttpRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const startedAt = Date.now();
    const loggedUrl = redactUrlForLogs(url);
    const redactedHeaders = redactHeaders(headers);
    let response: Awaited<ReturnType<typeof ssrfSafeFetch>>;
    try {
      response = await ssrfSafeFetch(url, {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
      });
    } catch (error) {
      const errorClass =
        error instanceof Error ? error.constructor.name : typeof error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        {
          url: loggedUrl,
          method,
          errorClass,
          message,
          durationMs: Date.now() - startedAt,
          headers: redactedHeaders,
        },
        "http call failed",
      );
      throw error;
    }

    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const responseBody =
        typeof response.text === "function"
          ? await response.text().catch(() => "")
          : "";
      const upstreamRequestId = pickUpstreamRequestId(response.headers);
      this.logger.warn(
        {
          url: loggedUrl,
          method,
          statusCode: response.status,
          durationMs,
          responseBodyPreview: previewResponseBody(responseBody),
          requestId: upstreamRequestId,
          headers: redactedHeaders,
        },
        "http call failed",
      );
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} from ${loggedUrl} (request-id: ${
          upstreamRequestId ?? "none"
        }): ${previewErrorBody(responseBody)}`,
      );
    }

    this.logger.info(
      {
        url: loggedUrl,
        method,
        statusCode: response.status,
        durationMs,
        requestId: pickUpstreamRequestId(response.headers),
        headers: redactedHeaders,
      },
      "http call ok",
    );

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  }

  private extractResponseContent(data: unknown): string {
    if (!this.config.outputPath?.trim() || !data) {
      return this.stringify(data);
    }

    try {
      const extracted = JSONPath({ path: this.config.outputPath, json: data });
      if (!extracted?.length) {
        return this.stringify(data);
      }
      return this.stringify(extracted[0]);
    } catch {
      return this.stringify(data);
    }
  }

  private stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private buildRequestBody(
    input: AgentInput,
    context: Record<string, unknown>,
  ): string {
    if (!this.config.bodyTemplate) {
      return JSON.stringify({ messages: input.messages });
    }

    return renderBodyTemplate({
      template: this.config.bodyTemplate,
      context,
    });
  }
}
