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
import type { RunParameterValues } from "../../parameters";
import { createChildProcessLogger } from "../child-logger";
import {
  buildTemplateContext,
  renderBodyTemplate,
  renderUrlTemplate,
} from "../http-template-engine";
import {
  preserveSecretRefs,
  redactSecrets,
  resolveAuthSecrets,
  resolveSecretRefsInTemplate,
  resolveSecretsInMap,
} from "../secret-references";
import type { HttpAgentData } from "../types";

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
  private readonly parameters: RunParameterValues;
  private capturedTraceId: string | undefined;

  constructor(
    config: HttpAgentData,
    logger?: Logger,
    /** The run's resolved values, read from url and body as `params.NAME`. */
    parameters?: RunParameterValues,
  ) {
    super();
    this.name = "SerializedHttpAgentAdapter";
    this.config = config;
    this.parameters = parameters ?? {};
    this.logger =
      logger ?? createChildProcessLogger("langwatch:scenarios:http-adapter");
  }

  /** The project secrets this target may reference, never empty-undefined. */
  private get secrets(): Record<string, string> {
    return this.config.secrets ?? {};
  }

  /** Returns the trace ID captured during the most recent HTTP request. */
  getTraceId(): string | undefined {
    return this.capturedTraceId;
  }

  async call(input: AgentInput): Promise<string> {
    try {
      const templateContext = buildTemplateContext({
        input,
        scenarioMappings: this.config.scenarioMappings,
        parameters: this.parameters,
      });
      const url = this.buildUrl(templateContext);
      const headers = this.buildRequestHeaders();
      const body = this.buildRequestBody(input, templateContext);
      const responseData = await this.executeHttpRequest(url, headers, body);
      return this.extractResponseContent(responseData);
    } catch (error) {
      throw this.scrubErrorChain(error);
    }
  }

  /** A message with every resolved secret value replaced by the placeholder. */
  private scrub(message: string): string {
    return redactSecrets(message, this.secrets);
  }

  /**
   * Scrubs an error and everything it was caused by, in place.
   *
   * The whole chain matters, not just the top: undici reports a transport
   * failure as a bare `TypeError: fetch failed` whose real reason, request
   * url and all, lives on `cause`, and the child process flattens the chain
   * into the message the run records. Rewriting messages rather than wrapping
   * keeps the error's class, its `code`, and the chain the failure classifier
   * reads. With no secrets configured this does nothing at all.
   */
  private scrubErrorChain(error: unknown): unknown {
    if (Object.keys(this.secrets).length === 0) return error;
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current);
      const scrubbed = this.scrub(current.message);
      if (scrubbed !== current.message) current.message = scrubbed;
      current = (current as { cause?: unknown }).cause;
    }
    return error;
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

    const resolved = {
      ...resolveSecretsInMap(headers, this.secrets),
      ...applyAuthentication(
        resolveAuthSecrets(this.config.auth, this.secrets),
      ),
    };

    const { traceId } = injectTraceContextHeaders({ headers: resolved });
    this.capturedTraceId = traceId;

    return resolved;
  }

  /**
   * Render the url, with secret references resolved first.
   *
   * Order matters: `secrets` is not a name the url engine binds, so rendering
   * first would turn `{{ secrets.AGENT_TOKEN }}` into an empty string and send
   * an unauthenticated request. Resolution therefore runs first, and what it
   * substitutes is fenced off from the render that follows, so a resolved
   * value reaches the wire byte for byte, and a reference to a name the
   * project does not have stays exactly as written.
   */
  private buildUrl(context: Record<string, unknown>): string {
    return renderUrlTemplate({
      template: resolveSecretRefsInTemplate(this.config.url, this.secrets),
      context,
    });
  }

  private async executeHttpRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const startedAt = Date.now();
    const loggedUrl = this.scrub(redactUrlForLogs(url));
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
      const message = this.scrub(
        error instanceof Error ? error.message : String(error),
      );
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
      const responseBody = this.scrub(
        typeof response.text === "function"
          ? await response.text().catch(() => "")
          : "",
      );
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
      template: preserveSecretRefs(this.config.bodyTemplate),
      context,
    });
  }
}
