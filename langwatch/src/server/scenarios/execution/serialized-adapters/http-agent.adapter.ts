/**
 * Serialized HTTP agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { JSONPath } from "jsonpath-plus";
import { createLogger } from "~/utils/logger";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../../adapters/auth.strategies";
import {
  buildTemplateContext,
  renderBodyTemplate,
  renderUrlTemplate,
} from "../http-template-engine";
import { injectTraceContextHeaders } from "../trace-context-headers";
import type { HttpAgentData } from "../types";

/** Header names (lowercase) whose values must be redacted in logs and errors. */
const SENSITIVE_HEADERS = new Set(["authorization", "x-api-key"]);

/** Maximum body length to include in errors and logs before truncating. */
const MAX_BODY_LENGTH = 2048;

/**
 * Serialized HTTP agent adapter that uses pre-fetched configuration.
 * No database access required.
 */
export class SerializedHttpAgentAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  private readonly config: HttpAgentData;
  private readonly logger: ReturnType<typeof createLogger>;
  private capturedTraceId: string | undefined;

  constructor(config: HttpAgentData) {
    super();
    this.name = "SerializedHttpAgentAdapter";
    this.config = config;
    this.logger = createLogger("langwatch:scenarios:http-agent");
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

    const response = await ssrfSafeFetch(url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
    });

    const durationMs = Date.now() - startedAt;

    // Read body once — used for both logging and error/response handling.
    const rawBody = await response.text();

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    // Extract upstream request id from response headers (priority order).
    const upstreamRequestId =
      response.headers.get("x-request-id") ??
      response.headers.get("x-amzn-requestid") ??
      response.headers.get("x-n8n-execution-id") ??
      undefined;

    // Truncate body sample for logging and error messages.
    const truncatedBody =
      rawBody.length > MAX_BODY_LENGTH
        ? `${rawBody.slice(0, MAX_BODY_LENGTH)}... [truncated]`
        : rawBody;

    // Build redacted copy of request headers for safe logging.
    const redactedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      redactedHeaders[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
        ? "[REDACTED]"
        : value;
    }

    // Emit exactly one structured diagnostic log per call.
    this.logger.info(
      {
        url,
        method,
        status: response.status,
        duration_ms: durationMs,
        request_id: upstreamRequestId,
        headers: redactedHeaders,
        body: truncatedBody,
      },
      "http_agent_call",
    );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText} from ${url} (request-id: ${upstreamRequestId ?? "none"}): ${truncatedBody}`,
      );
    }

    return parsedBody;
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
