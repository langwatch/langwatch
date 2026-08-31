/**
 * Serialized HTTP agent adapter for scenario worker execution.
 *
 * Operates with pre-fetched configuration data and doesn't require
 * database access. Designed to run in isolated worker threads.
 */

import { createLogger, type Logger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import {
  buildTemplateContext,
  mergePropagationHeaders,
  renderBodyTemplate,
  renderHeaderTemplate,
  renderUrlTemplate,
} from "@langwatch/scenario-contract";
import { JSONPath } from "jsonpath-plus";
import { applyAuthentication } from "./http-auth.adapter";
import type { RunParameterValues } from "@langwatch/scenario-contract";
import { ScenarioSecretReferenceAdapter } from "./scenario-secret-reference.adapter";
import type { HttpAgentData } from "@langwatch/scenario-contract";
import type { ScenarioHttpPort } from "../ports/scenario-http.port";

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

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
}

/**
 * Pick the upstream request id (first match wins). Different upstreams use
 * different header conventions — surface whichever the target chose.
 */
function pickUpstreamRequestId(headers: { get(name: string): string | null }): string | undefined {
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
  static create(options: {
    config: HttpAgentData;
    logger?: Logger;
    parameters?: RunParameterValues;
    httpPort?: ScenarioHttpPort;
  }): SerializedHttpAgentAdapter {
    return new SerializedHttpAgentAdapter(options);
  }

  role = AgentRole.AGENT;

  private readonly config: HttpAgentData;
  private readonly logger: Logger;
  private readonly parameters: RunParameterValues;
  private readonly httpPort: ScenarioHttpPort | undefined;

  constructor({
    config,
    logger,
    parameters,
    httpPort,
  }: {
    config: HttpAgentData;
    logger?: Logger;
    /** The run's resolved values, read from url and body as `params.NAME`. */
    parameters?: RunParameterValues;
    httpPort?: ScenarioHttpPort;
  }) {
    super();
    this.name = "SerializedHttpAgentAdapter";
    this.config = config;
    this.parameters = parameters ?? {};
    this.httpPort = httpPort;
    this.logger = logger ?? createLogger("langwatch:scenarios:http-adapter");
  }

  /** The project secrets this target may reference, never empty-undefined. */
  private get secrets(): Record<string, string> {
    return this.config.secrets ?? {};
  }

  async call(input: AgentInput): Promise<string> {
    try {
      // One capture per turn: the traceparent header and the `{{ traceId }}`
      // / `{{ traceparent }}` template variables all name the same trace.
      const { headers: propagationHeaders, traceId } = injectTraceContextHeaders({
        headers: {},
      });
      const traceparent = propagationHeaders.traceparent;
      const templateContext = buildTemplateContext({
        input,
        scenarioMappings: this.config.scenarioMappings,
        parameters: this.parameters,
        traceContext: { traceId, traceparent },
      });
      const url = this.buildUrl(templateContext);
      const headers = this.buildRequestHeaders(templateContext, propagationHeaders);
      const body = this.buildRequestBody(input, templateContext);
      const responseData = await this.executeHttpRequest(url, headers, body);
      return this.extractResponseContent(responseData);
    } catch (error) {
      throw this.scrubErrorChain(error);
    }
  }

  /** A message with every resolved secret value replaced by the placeholder. */
  private scrub(message: string): string {
    return ScenarioSecretReferenceAdapter.redact({ message, secrets: this.secrets });
  }

  /**
   * Header values for a log line: masked by name, then scrubbed by value.
   *
   * The name list only covers the headers that carry a credential by
   * convention. A target may write `{{ secrets.NAME }}` into any header it
   * likes, so `X-Custom-Token` holds a real credential and no name list can
   * know that. The value scrub is what covers the rest.
   */
  private headersForLogs(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(redactHeaders(headers)).map(([key, value]) => [key, this.scrub(value)]),
    );
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

  /**
   * Each configured header value renders through the header engine with the
   * same fence/restore discipline as `buildUrl` (see its comment for why the
   * order matters). The fence is also what resolves the references, so
   * rendered output is never re-scanned for them: a conversation turn or a
   * run parameter that spells `{{ secrets.NAME }}` stays literal text instead
   * of pulling the credential into the request. Auth goes on top as before,
   * and the propagation headers merge last without clobbering one the target
   * configured itself.
   */
  private buildRequestHeaders(
    context: Record<string, unknown>,
    propagationHeaders: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    for (const header of this.config.headers) {
      const key = header.key.trim();
      if (key) {
        const { template, restore } = ScenarioSecretReferenceAdapter.fence({
          template: header.value,
          secrets: this.secrets,
        });
        headers[key] = restore(renderHeaderTemplate({ template, context, headerKey: key }));
      }
    }

    const resolved = {
      ...headers,
      ...applyAuthentication(
        ScenarioSecretReferenceAdapter.resolveAuth({
          auth: this.config.auth,
          secrets: this.secrets,
        }),
      ),
    };

    return mergePropagationHeaders({ headers: resolved, propagationHeaders });
  }

  /**
   * Render the url, with secret references resolved first.
   *
   * Order matters: `secrets` is not a name the url engine binds, so rendering
   * first would turn `{{ secrets.AGENT_TOKEN }}` into an empty string and send
   * an unauthenticated request. Resolution therefore runs first, and what it
   * resolved is held out of the render entirely and put back afterwards, so a
   * resolved value reaches the wire byte for byte without ever being read as
   * template source, and a reference to a name the project does not have stays
   * exactly as written.
   */
  private buildUrl(context: Record<string, unknown>): string {
    const { template, restore } = ScenarioSecretReferenceAdapter.fence({
      template: this.config.url,
      secrets: this.secrets,
    });
    return restore(renderUrlTemplate({ template, context }));
  }

  private async executeHttpRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const startedAt = Date.now();
    const loggedUrl = this.scrub(redactUrlForLogs(url));
    const redactedHeaders = this.headersForLogs(headers);
    let response;
    try {
      if (!this.httpPort) {
        throw new Error("Serialized HTTP scenario adapter requires a ScenarioHttpPort");
      }
      response = await this.httpPort.fetch({
        url,
        init: {
          method,
          headers,
          ...(method !== "GET" ? { body } : {}),
        },
      });
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      const message = this.scrub(error instanceof Error ? error.message : String(error));
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
        typeof response.text === "function" ? await response.text().catch(() => "") : "",
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

  private buildRequestBody(input: AgentInput, context: Record<string, unknown>): string {
    if (!this.config.bodyTemplate) {
      return JSON.stringify({ messages: input.messages });
    }

    const { template, restore } = ScenarioSecretReferenceAdapter.preserve(this.config.bodyTemplate);
    return restore(renderBodyTemplate({ template, context }));
  }
}
