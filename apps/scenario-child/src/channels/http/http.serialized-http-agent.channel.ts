/**
 * Serialized HTTP agent adapter for scenario worker execution. Operates with pre-fetched
 * configuration data and doesn't require database access. Designed to run in isolated worker
 * threads.
 */

import { STATE_MAX_BYTES } from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import {
  buildTemplateContext,
  mergePropagationHeaders,
  renderBodyTemplate,
  renderHeaderTemplate,
  renderUrlTemplate,
} from "@langwatch/scenario-contract";
import type { HttpAgentData, RunParameterValues } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { JSONPath } from "jsonpath-plus";

import { applyAuthentication } from "../../rules/http-auth.rules.ts";
import {
  hookAnswer,
  hookIdempotencyKey,
  hookRequestBody,
  hookSignature,
  hooksUrlRefusal,
  hookTimeoutMessage,
  HttpHookError,
  IDEMPOTENCY_HEADER,
  readCappedBody,
  scrubbedObject,
  SIGNATURE_HEADER,
  withoutReservedHookHeaders,
  type HookBodyStream,
  type HttpHookKind,
  type HttpHookObject,
  type HttpHookRun,
} from "../../rules/http-hook.rules.ts";
import * as ScenarioSecretReferenceAdapter from "../../rules/scenario-secret-reference.rules.ts";
import { SerializedAgentChannel } from "../serialized-agent.channel.ts";

/** Response boundary required by serialized HTTP scenario targets. */
export interface ScenarioHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Pick<Headers, "get">;
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** The body as a stream, read with a size cap where the cap matters (a hook's answer). */
  body?: HookBodyStream | null;
}

/**
 * Named egress boundary for an HTTP scenario target. The child's entrypoint supplies the
 * SSRF-safe implementation; no adapter reaches for native fetch.
 */
export interface ScenarioHttp {
  fetch(input: {
    url: string;
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      /** Ends the request, redirects included, when a hook's budget runs out. */
      signal?: AbortSignal;
    };
  }): Promise<ScenarioHttpResponse>;
}

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
 * A call that never reached the target: DNS did not resolve, the connection was refused or reset,
 * or the request timed out at the socket.
 */
export class HttpAgentTransportError extends Error {
  constructor({ host, reason, cause }: { host: string; reason: string; cause: unknown }) {
    super(`HTTP agent target ${host} could not be reached: ${reason}`);
    this.name = "HttpAgentTransportError";
    this.cause = cause;
  }
}

/**
 * The host of a request url. A url that does not parse gets a fixed label:
 * it can carry a credential in its query, and this text reaches a customer.
 */
function hostForMessage(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "configured target";
  }
}

/**
 * Flattens an error and its causes into one line of messages. undici reports a transport failure as
 * a bare `TypeError: fetch failed` whose real reason lives on `cause`, so the top message alone
 * classifies as nothing. Messages only — a stack never enters the text a customer reads.
 */
function flattenErrorMessages(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message.trim();
    if (message.length > 0 && !parts.includes(message)) parts.push(message);
    current = (current as { cause?: unknown }).cause;
  }
  if (parts.length === 0) return String(error);
  return parts.join(": ");
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
function pickUpstreamRequestId(headers: Pick<Headers, "get">): string | undefined {
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
export class HttpSerializedHttpAgentChannel extends SerializedAgentChannel {
  static create(options: {
    config: HttpAgentData;
    logger?: Logger;
    parameters?: RunParameterValues;
    httpPort?: ScenarioHttp;
    run?: HttpHookRun;
    attemptId?: string;
  }): HttpSerializedHttpAgentChannel {
    return new HttpSerializedHttpAgentChannel(options);
  }

  role = AgentRole.AGENT;

  private readonly config: HttpAgentData;
  private readonly logger: Logger;
  private readonly parameters: RunParameterValues;
  private readonly httpPort: ScenarioHttp | undefined;
  private readonly run: HttpHookRun;
  /** This execution of the run; a re-executed run gets a new one, and so a new idempotency key. */
  private readonly attemptId: string;
  /** What setup returned; an HTTP turn never changes it (ADR-188). */
  private state: HttpHookObject | null = null;

  constructor({
    config,
    logger,
    parameters,
    httpPort,
    run,
    attemptId,
  }: {
    config: HttpAgentData;
    logger?: Logger;
    /** The run's resolved values, read from url and body as `params.NAME`. */
    parameters?: RunParameterValues;
    httpPort?: ScenarioHttp;
    /** The scenario run the hook calls name; absent outside a scenario run. */
    run?: HttpHookRun;
    /** Fixed in a test; a fresh id per channel otherwise. */
    attemptId?: string;
  }) {
    super();
    this.name = "SerializedHttpAgentAdapter";
    this.config = config;
    this.parameters = parameters ?? {};
    this.httpPort = httpPort;
    this.run = run ?? {};
    this.attemptId = attemptId ?? generate("hookattempt").toString();
    this.logger = logger ?? createLogger("langwatch:scenarios:http-adapter");
  }

  /** The run's state as turns and teardown see it, or nothing before setup answered. */
  get runState(): HttpHookObject | null {
    return this.state;
  }

  /** The state a turn template reads, bound only for an agent with a hooks URL. */
  private get templateState(): { state?: HttpHookObject | null } {
    return this.config.hooksUrl ? { state: this.state } : {};
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
        session: this.sessionOf(input.threadId),
        ...this.templateState,
      });
      const url = this.buildUrl(templateContext);
      const headers = this.buildRequestHeaders(templateContext, propagationHeaders);
      const body = this.buildRequestBody(input, templateContext);
      const responseData = await this.executeHttpRequest(url, headers, body);
      this.storeSession({
        threadId: input.threadId,
        session: this.extractSession(responseData),
      });
      return this.extractResponseContent(responseData);
    } catch (error) {
      throw this.scrubErrorChain(error);
    }
  }

  /**
   * POSTs one setup or teardown to the hooks URL, signed (ADR-188). Setup's object becomes the
   * run's state; teardown's is returned and not kept.
   * @throws HttpHookError when the hook fails, times out or answers without a JSON object.
   */
  async callHook({
    kind,
    timeoutMs,
  }: {
    kind: HttpHookKind;
    timeoutMs: number;
  }): Promise<{ state?: HttpHookObject }> {
    try {
      const answer = await this.sendHook({ kind, timeoutMs });
      if (kind === "setup") this.state = answer ?? null;
      return answer ? { state: answer } : {};
    } catch (error) {
      throw this.scrubErrorChain(error);
    }
  }

  private async sendHook({
    kind,
    timeoutMs,
  }: {
    kind: HttpHookKind;
    timeoutMs: number;
  }): Promise<HttpHookObject | undefined> {
    const { hooksUrl } = this.config;
    if (!hooksUrl) throw new HttpHookError({ message: "The agent has no hooks URL." });
    const refusal = hooksUrlRefusal(hooksUrl);
    if (refusal) throw new HttpHookError({ message: refusal });
    const secret = this.signingSecret();
    const { headers: propagationHeaders, traceId } = injectTraceContextHeaders({ headers: {} });
    const context = buildTemplateContext({
      input: { messages: [] },
      parameters: this.parameters,
      traceContext: { traceId, traceparent: propagationHeaders.traceparent },
      state: this.state,
    });
    const url = this.buildUrl(context, hooksUrl);
    // A template can render to a host the raw value did not show.
    const renderedRefusal = hooksUrlRefusal(url);
    if (renderedRefusal) throw new HttpHookError({ message: renderedRefusal });
    const idempotencyKey = hookIdempotencyKey({
      run: this.run,
      attemptId: this.attemptId,
      kind,
    });
    const body = hookRequestBody({
      kind,
      run: this.run,
      idempotencyKey,
      params: this.parameters,
      state: this.state,
    });
    const headers = {
      ...withoutReservedHookHeaders(this.buildRequestHeaders(context, propagationHeaders)),
      [SIGNATURE_HEADER]: hookSignature({
        secret,
        body,
        timestampSeconds: Math.floor(nowInstant().epochMilliseconds / 1000),
      }),
      [IDEMPOTENCY_HEADER]: idempotencyKey,
    };
    const { status, text, overCap } = await this.postHook({ url, headers, body, timeoutMs });
    this.logger.info(
      { kind, url: this.scrub(redactUrlForLogs(url)), status },
      "http hook answered",
    );
    // Measured and parsed as it came: scrubbing first changes its size and can break its JSON.
    // Error messages are scrubbed on the way out (callHook); the state is scrubbed here.
    const answer = hookAnswer({ kind, status, body: text, overCap });
    return answer && scrubbedObject(answer, (value) => this.scrub(value));
  }

  /** The resolved signing secret; a hook is never sent unsigned. */
  private signingSecret(): string {
    const reference = this.config.hooksSigningSecret ?? "";
    const secret = ScenarioSecretReferenceAdapter.resolve({
      value: reference,
      secrets: this.secrets,
    });
    if (secret === "" || secret.includes("{{")) {
      throw new HttpHookError({
        message: "The hooks signing secret is missing. Rotate it in the agent's Hooks tab.",
      });
    }
    return secret;
  }

  private async postHook({
    url,
    headers,
    body,
    timeoutMs,
  }: {
    url: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<{ status: number; text: string; overCap: boolean }> {
    if (!this.httpPort)
      throw new Error("Serialized HTTP scenario adapter requires a ScenarioHttpPort");
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.httpPort.fetch({
        url,
        init: { method: "POST", headers, body, signal },
      });
      if (!response.body)
        return { status: response.status, text: await response.text(), overCap: false };
      const { text, overCap } = await readCappedBody({
        stream: response.body,
        maxBytes: STATE_MAX_BYTES,
      });
      return { status: response.status, text, overCap };
    } catch (error) {
      if (signal.aborted) {
        throw new HttpHookError({
          message: hookTimeoutMessage(timeoutMs),
          isTimeout: true,
        });
      }
      throw new HttpAgentTransportError({
        host: hostForMessage(url),
        reason: this.scrub(flattenErrorMessages(error)),
        cause: error,
      });
    }
  }

  /** A message with every resolved secret value replaced by the placeholder. */
  private scrub(message: string): string {
    return ScenarioSecretReferenceAdapter.redact({ message, secrets: this.secrets });
  }

  /**
   * Header values for a log line: masked by name, then scrubbed by value. The name list only covers
   * the headers that carry a credential by convention.
   */
  private headersForLogs(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(redactHeaders(headers)).map(([key, value]) => [key, this.scrub(value)]),
    );
  }

  /**
   * Scrubs an error and everything it was caused by, in place.
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
   * Each configured header value renders through the header engine with the same fence/restore
   * discipline as `buildUrl` (see its comment for why the order matters).
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
        ScenarioSecretReferenceAdapter.renderAuth({
          auth: this.config.auth,
          secrets: this.secrets,
        }),
      ),
    };

    return mergePropagationHeaders({ headers: resolved, propagationHeaders });
  }

  /**
   * Render the url, with secret references resolved first. Order matters: `secrets` is not a name
   * the url engine binds, so rendering first would turn `{{ secrets.AGENT_TOKEN }}` into an empty
   * string and send an unauthenticated request.
   */
  private buildUrl(context: Record<string, unknown>, urlTemplate = this.config.url): string {
    const { template, restore } = ScenarioSecretReferenceAdapter.fence({
      template: urlTemplate,
      secrets: this.secrets,
    });
    return restore(renderUrlTemplate({ template, context }));
  }

  /**
   * Logs an upstream error response and throws the error the caller reports.
   * It never returns.
   */
  private async failOnErrorResponse({
    response,
    loggedUrl,
    method,
    durationMs,
    redactedHeaders,
  }: {
    response: Awaited<ReturnType<ScenarioHttp["fetch"]>>;
    loggedUrl: string;
    method: string;
    durationMs: number;
    redactedHeaders: Record<string, string>;
  }): Promise<never> {
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

  private async executeHttpRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<unknown> {
    const method = this.config.method.toUpperCase();
    const startedAt = nowInstant().epochMilliseconds;
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
          durationMs: nowInstant().epochMilliseconds - startedAt,
          headers: redactedHeaders,
        },
        "http call failed",
      );
      throw new HttpAgentTransportError({
        host: hostForMessage(url),
        reason: this.scrub(flattenErrorMessages(error)),
        cause: error,
      });
    }

    const durationMs = nowInstant().epochMilliseconds - startedAt;

    if (!response.ok) {
      await this.failOnErrorResponse({
        response,
        loggedUrl,
        method,
        durationMs,
        redactedHeaders,
      });
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
      return response.json();
    }
    return response.text();
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

  /**
   * The session the response carries at `sessionPath`, or nothing: no path configured, a body that
   * is not JSON, a path that matches nothing and a path that does not parse all leave the held
   * value as it is.
   */
  private extractSession(data: unknown): unknown {
    const path = this.config.sessionPath?.trim();
    if (!path || data === null || typeof data !== "object") return undefined;

    try {
      const extracted = JSONPath({ path, json: data }) as unknown[];
      return extracted.length > 0 ? extracted[0] : undefined;
    } catch (error) {
      this.logger.warn(
        {
          sessionPath: path,
          message: error instanceof Error ? error.message : String(error),
        },
        "session path did not parse, keeping the held session",
      );
      return undefined;
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
