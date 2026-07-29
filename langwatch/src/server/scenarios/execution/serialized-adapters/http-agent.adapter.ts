/**
 * Serialized HTTP agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import type { Logger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { JSONPath } from "jsonpath-plus";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { applyAuthentication } from "../../adapters/auth.strategies";
import { createChildProcessLogger } from "../child-logger";
import {
  buildTemplateContext,
  renderBodyTemplate,
  renderUrlTemplate,
} from "../http-template-engine";
import type { HttpAgentData } from "../types";

/**
 * Truncate a response body for log inclusion. Long bodies are useless in
 * CloudWatch and explode log volume; the prefix is enough to spot the
 * upstream's failure mode.
 *
 * The preview is emitted at `debug` and never above it: the body belongs to
 * the customer's own agent, so at `info`/`warn` it would put their content
 * into the platform's log retention. Status, latency and upstream request id
 * say what went wrong without quoting them, and the thrown error still carries
 * the body to the scenario result — where the customer expects to read it.
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

/**
 * Header names (lowercase) whose VALUES are safe to write to a log.
 *
 * This is an allow-list, not a deny-list, and it has to be: the header a
 * credential arrives under is chosen by the user. `AUTH_STRATEGIES.api_key`
 * emits `{ [auth.header]: auth.value }` with a user-supplied header NAME, and
 * `config.headers` lets a target add arbitrary pairs on top. A target
 * configured with `X-Auth-Token`, `apikey` or `Cookie` would have its secret
 * written verbatim on every call — including the `info` line on SUCCESS — for
 * as long as the deny-list failed to guess that name.
 *
 * Only one class of NAME is listed: content negotiation, which by convention
 * never carries credentials. Everything else logs its key with a `[REDACTED]`
 * value, so an operator can still see WHICH headers were sent without the
 * platform having to predict what a customer will call its secret.
 *
 * The W3C trace-context headers are deliberately NOT here. They are loggable
 * by PROVENANCE, not by name: `propagation.inject()` writes `traceparent` only
 * when a span is active and `tracestate` only when there is vendor state to
 * carry, so a target that configured a header literally named `tracestate`
 * keeps its own value — and that value is user-supplied. Only the ones this
 * adapter's own injection wrote are logged; see `buildRequestHeaders`.
 */
const LOGGABLE_HEADERS = new Set(["content-type", "accept"]);

/** W3C trace-context header names, lowercased. */
const TRACE_CONTEXT_HEADERS = new Set(["traceparent", "tracestate"]);

/** Maximum body length to include in error messages before truncating. */
const ERROR_BODY_LIMIT_CHARS = 2048;

function previewErrorBody(body: string): string {
  if (body.length <= ERROR_BODY_LIMIT_CHARS) {
    return body;
  }
  return `${body.slice(0, ERROR_BODY_LIMIT_CHARS)}... [truncated]`;
}

/**
 * @param injectedTraceHeaders - EXACT header keys whose value trace-context
 *   injection produced. Matched exactly, not case-insensitively: a target may
 *   configure `TraceState` alongside the injected `tracestate`, and only the
 *   latter is ours to log.
 */
function redactHeaders({
  headers,
  injectedTraceHeaders,
}: {
  headers: Record<string, string>;
  injectedTraceHeaders: ReadonlySet<string>;
}): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const loggable =
      LOGGABLE_HEADERS.has(key.toLowerCase()) || injectedTraceHeaders.has(key);
    redacted[key] = loggable ? value : "[REDACTED]";
  }
  return redacted;
}

/**
 * Pick the upstream request id (first match wins). Different upstreams use
 * different header conventions — surface whichever the target chose.
 */
function pickUpstreamRequestId(headers: {
  get(name: string): string | null;
}): string | undefined {
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
    const { headers, injectedTraceHeaders } = this.buildRequestHeaders();
    const body = this.buildRequestBody(input, templateContext);
    const responseData = await this.executeHttpRequest({
      url,
      headers,
      injectedTraceHeaders,
      body,
    });
    return this.extractResponseContent(responseData);
  }

  private buildRequestHeaders(): {
    headers: Record<string, string>;
    injectedTraceHeaders: ReadonlySet<string>;
  } {
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

    // Snapshot the user-controlled values first: everything above this line
    // came from the target's own config, including anything that happens to
    // be named `traceparent` or `tracestate`.
    const configuredTraceHeaders = new Map(
      Object.entries(headers).filter(([key]) =>
        TRACE_CONTEXT_HEADERS.has(key.toLowerCase()),
      ),
    );

    const { traceId } = injectTraceContextHeaders({ headers });
    this.capturedTraceId = traceId;

    // A trace header is ours to log only if injection wrote it — either it
    // was absent before, or injection overwrote what the target configured.
    const injectedTraceHeaders = new Set(
      Object.entries(headers)
        .filter(
          ([key, value]) =>
            TRACE_CONTEXT_HEADERS.has(key.toLowerCase()) &&
            configuredTraceHeaders.get(key) !== value,
        )
        .map(([key]) => key),
    );

    return { headers, injectedTraceHeaders };
  }

  private buildUrl(context: Record<string, unknown>): string {
    return renderUrlTemplate({ template: this.config.url, context });
  }

  private async executeHttpRequest({
    url,
    headers,
    injectedTraceHeaders,
    body,
  }: {
    url: string;
    headers: Record<string, string>;
    injectedTraceHeaders: ReadonlySet<string>;
    body: string;
  }): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const startedAt = Date.now();
    const loggedUrl = redactUrlForLogs(url);
    const redactedHeaders = redactHeaders({ headers, injectedTraceHeaders });
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
          responseBodyLength: responseBody.length,
          requestId: upstreamRequestId,
          headers: redactedHeaders,
        },
        "http call failed",
      );
      this.logger.debug(
        {
          url: loggedUrl,
          method,
          statusCode: response.status,
          responseBodyPreview: previewResponseBody(responseBody),
        },
        "http call failed, response body preview",
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
