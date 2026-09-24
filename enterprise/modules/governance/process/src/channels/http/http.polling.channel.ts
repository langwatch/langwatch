// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernancePuller as PullerAdapter,
  NormalizedPullEvent,
  PullResult,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { DispatchError, parseRetryAfterMs } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
/**
 * HttpPollingPullerAdapter — universal HTTP-polling adapter for
 * paginated REST audit-log APIs. Mirrors Airbyte's HTTP-source
 * connector and Singer Tap's REST extractor: declare the URL +
 * auth + pagination shape + JSON-path mappings, get pull behaviour
 * for free.
 *
 * Customers writing a new puller for an OpenAPI-style audit-log
 * endpoint should NOT implement PullerAdapter directly. Instead they
 * either (a) configure this adapter from the admin UI with the right
 * pullConfig, or (b) extend a thin wrapper that locks the URL + auth
 * shape and only exposes credentials (see
 * `copilotStudio.puller.ts` for the reference impl).
 *
 * Spec: specs/ai-governance/puller-framework/http-polling.feature
 */
import { JSONPath } from "jsonpath-plus";
import { z } from "zod";

import type {
  GovernanceHttpClient,
  GovernanceHttpResponse,
  IngestionPullDiagnosticsSink,
} from "../../app/governance.members.ts";

const TEMPLATE_PATTERN = /\$\{\{([\w.]+)\}\}/g;
const RETRY_DELAYS_MS = [250, 500] as const;
const MAX_PAGES_PER_RUN = 50; // safety cap so a misconfigured cursor doesn't loop forever
const REQUEST_TIMEOUT_MS = 30_000;

const nullDiagnostics: IngestionPullDiagnosticsSink = {
  info: () => {},
  warn: () => {},
  error: () => {},
  capture: () => {},
};

const eventMappingSchema = z.object({
  source_event_id: z.string().min(1),
  event_timestamp: z.string().min(1),
  actor: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  cost_usd: z.string().optional(),
  tokens_input: z.string().optional(),
  tokens_output: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

const httpPollingConfigSchema = z.object({
  adapter: z.literal("http_polling"),
  url: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  /**
   * Optional request body for POST. Templating same as headers.
   */
  body: z.string().optional(),
  /**
   * `bearer`         — the credentialRef must resolve to `{ token }`
   *                    and the adapter sets `Authorization: Bearer ...`
   *                    automatically (in addition to declared headers).
   * `header_template` — caller declares the auth header explicitly in
   *                    `headers`; no automatic injection. Use for APIs
   *                    that want a non-standard header (X-API-Key etc.).
   */
  authMode: z.enum(["bearer", "header_template"]),
  credentialRef: z.string().min(1).optional(),
  /**
   * JSONPath into the response body to extract the next-page cursor.
   * `null`/missing = drained.
   */
  cursorJsonPath: z.string().min(1),
  /**
   * Query-param name for cursor on subsequent pages. Defaults to
   * `cursor`. Some APIs use `next_token`, `pageToken`, `$skiptoken`,
   * etc. — declare the right one here.
   */
  cursorQueryParam: z.string().default("cursor"),
  /** JSONPath into the response body to extract the events array. */
  eventsJsonPath: z.string().min(1),
  /** cron string for scheduling (validated before the process event). */
  schedule: z.string().min(1),
  /** Per-event JSONPath mappings (NormalizedPullEvent shape). */
  eventMapping: eventMappingSchema,
});

export type HttpPollingConfig = z.infer<typeof httpPollingConfigSchema>;

function mappedValue(rawEvent: unknown, path: string | undefined): unknown {
  if (path === undefined) return undefined;
  const json = toJsonInput(rawEvent);
  return JSONPath({
    path,
    json,
    wrap: false,
  });
}

function toJsonInput(value: unknown): string | number | boolean | object | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "object") return value;
  return null;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asDecimalString(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? "0" : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "0";
}

function asInt(value: unknown): number {
  return Math.trunc(asNumber(value));
}

/**
 * Ends the request when the provider has asked for fewer of them, carrying the
 * wait it named.
 *
 * A 429 used to fall into the generic 4xx branch and throw a plain Error. That
 * ended the run correctly and dropped the one number saying when it is safe to
 * come back, so the next run walked into the window this one was refused in.
 * Returns for every other answer, including the ones that do retry.
 */
async function refuseIfRateLimited({
  response,
  url,
}: {
  response: GovernanceHttpResponse;
  url: string;
}): Promise<void> {
  if (response.status !== 429) return;
  throw new DispatchError({
    message: `HTTP 429 ${response.statusText} (${url})`,
    retryable: true,
    retryAfterMs: parseRetryAfterMs(response.headers?.get("retry-after")),
  });
}

/**
 * Lets a provider asking for silence out of the run, and lets every other
 * failure fall through to be absorbed into an error count.
 *
 * The distinction is the whole point. An error count is a number on a screen;
 * a wait is an instruction, and absorbing it strands it inside a run that then
 * reports success, so the next run walks back into the window this one was
 * refused in. Leaving by the error path is the only way it reaches the
 * connection that has to honour it.
 *
 * Every `DispatchError`, not only one that named a wait. A 429 with no
 * `Retry-After` — or one this build cannot read as a length of time — is still
 * a provider asking for silence, and absorbing it relabels the run's recorded
 * reason as an ordinary transport failure, which is what an administrator then
 * reads on the source.
 */
function rethrowIfRateLimited({
  error,
  adapter,
  url,
  diagnostics,
}: {
  error: unknown;
  adapter: string;
  url: string;
  diagnostics: IngestionPullDiagnosticsSink;
}): void {
  if (!(error instanceof DispatchError)) return;
  diagnostics.warn(
    "HttpPollingPullerAdapter: provider asked for fewer requests; ending the run with its wait",
    { adapter, url, retryAfterMs: error.retryAfterMs },
  );
  throw error;
}

export class HttpPollingPullerAdapter implements PullerAdapter<HttpPollingConfig> {
  readonly id: string = "http_polling";

  protected constructor(
    private readonly http: GovernanceHttpClient,
    private readonly diagnostics: IngestionPullDiagnosticsSink = nullDiagnostics,
  ) {}

  static create(options: {
    http: GovernanceHttpClient;
    diagnostics?: IngestionPullDiagnosticsSink;
  }): HttpPollingPullerAdapter {
    return new HttpPollingPullerAdapter(options.http, options.diagnostics ?? nullDiagnostics);
  }

  validateConfig(config: unknown): HttpPollingConfig {
    return httpPollingConfigSchema.parse(config);
  }

  async runOnce(options: PullRunOptions, config: HttpPollingConfig): Promise<PullResult> {
    const allEvents: NormalizedPullEvent[] = [];
    let cursor = options.cursor;
    let pageCount = 0;

    while (pageCount < MAX_PAGES_PER_RUN) {
      pageCount += 1;
      if (options.deadlineMs !== undefined && nowInstant().epochMilliseconds > options.deadlineMs) {
        this.diagnostics.info("Deadline reached mid-pagination, returning cursor for next run", {
          adapter: this.id,
          pageCount,
          cursor,
        });
        // Pages are still waiting. Saying nothing here reads as "complete",
        // which is how a source permanently stuck on a fraction of its data
        // looked exactly like a healthy quiet one.
        return { events: allEvents, cursor, errorCount: 0, completeness: "truncated" };
      }

      let response: GovernanceHttpResponse;
      try {
        response = await this.fetchPage({ config, cursor, options });
      } catch (error) {
        // Rethrows a provider asking for silence and absorbs everything else.
        rethrowIfRateLimited({
          error,
          adapter: this.id,
          url: config.url,
          diagnostics: this.diagnostics,
        });
        this.diagnostics.error("HttpPollingPullerAdapter: fetch failed (all retries exhausted)", {
          adapter: this.id,
          url: config.url,
          cursor,
          error: error instanceof Error ? error.message : String(error),
        });
        // Cursor unchanged — caller leaves IngestionSource.pollerCursor
        // at its prior value so the next run resumes from the last
        // known-good page.
        return { events: allEvents, cursor: options.cursor, errorCount: 1 };
      }

      const body = (await response.json()) as unknown;
      const pageEvents = this.extractEvents({ body, config });
      allEvents.push(...pageEvents);

      const nextCursor = this.extractCursor({ body, config });
      if (!nextCursor) {
        return { events: allEvents, cursor: null, errorCount: 0 };
      }
      cursor = nextCursor;
    }

    // Hit the page cap — surface the cursor so the next run picks
    // up from here, but log a warning since this likely indicates a
    // misconfigured cursor or pathological response shape.
    this.diagnostics.warn("HttpPollingPullerAdapter: hit MAX_PAGES_PER_RUN safety cap", {
      adapter: this.id,
      url: config.url,
      pageCount,
      cursor,
    });
    return { events: allEvents, cursor, errorCount: 0, completeness: "truncated" };
  }

  private async fetchPage({
    config,
    cursor,
    options,
  }: {
    config: HttpPollingConfig;
    cursor: string | null;
    options: PullRunOptions;
  }): Promise<GovernanceHttpResponse> {
    const url = this.buildUrl({ config, cursor });
    const headers = this.buildHeaders({ config, options });
    const body =
      config.method === "POST" && config.body
        ? this.substituteTemplate({
            template: config.body,
            credentials: options.credentials ?? {},
            context: options.context,
          })
        : undefined;

    return this.fetchWithRetries({ url, method: config.method, headers, body, options });
  }

  private async fetchWithRetries({
    url,
    method,
    headers,
    body,
    options,
  }: {
    url: string;
    method: HttpPollingConfig["method"];
    headers: Record<string, string>;
    body: string | undefined;
    options: PullRunOptions;
  }): Promise<GovernanceHttpResponse> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        // Two independent bounds: this request's own timeout, and the run's
        // deadline. Either one firing must unwind the call.
        const signal = options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = await this.http.fetch(url, {
          method,
          headers,
          body,
          signal,
          // Source headers carry the decrypted upstream secret. Refuse a
          // redirect rather than forwarding those headers to another host.
          followRedirects: false,
        });
        await refuseIfRateLimited({ response, url });
        if (response.status >= 500) {
          // Retryable — fall through to the retry-delay branch
          lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
        } else if (response.status >= 400) {
          // 4xx fails fast — no retry
          throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
        } else {
          return response;
        }
      } catch (error) {
        lastError = this.normalizedRetryError(error);
      }
      // Retrying past the run's deadline just burns time the scheduler has
      // already given up waiting for.
      if (options.signal?.aborted) break;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && attempt < RETRY_DELAYS_MS.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError ?? new Error("HttpPollingPullerAdapter: unknown error");
  }

  private normalizedRetryError(error: unknown): Error {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized.name === "RedirectRefusedError") throw normalized;

    // 4xx errors land here too (re-thrown above); only retry on
    // network/transport errors and 5xx.
    if (/^HTTP 4\d{2}/.test(normalized.message)) throw normalized;
    return normalized;
  }

  private buildUrl({
    config,
    cursor,
  }: {
    config: HttpPollingConfig;
    cursor: string | null;
  }): string {
    if (cursor === null) return config.url;
    // Some APIs return a fully-qualified `nextLink` URL as the cursor
    // (Microsoft Graph audit-log API does this). Detect + use as-is
    // when present so we don't double-append the cursor query param.
    if (/^https?:\/\//i.test(cursor)) return cursor;
    const parsed = new URL(config.url);
    parsed.searchParams.set(config.cursorQueryParam, cursor);
    return parsed.toString();
  }

  private buildHeaders({
    config,
    options,
  }: {
    config: HttpPollingConfig;
    options: PullRunOptions;
  }): Record<string, string> {
    const credentials = options.credentials ?? {};
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.headers)) {
      headers[k] = this.substituteTemplate({
        template: v,
        credentials,
        context: options.context,
      });
    }
    // Inject standard Authorization header. If the caller already declared one
    // in `headers`, theirs wins.
    if (
      config.authMode === "bearer" &&
      credentials.token &&
      !("Authorization" in headers) &&
      !("authorization" in headers)
    ) {
      headers.Authorization = `Bearer ${credentials.token}`;
    }
    return headers;
  }

  private substituteTemplate({
    template,
    credentials,
    context,
  }: {
    template: string;
    credentials: Record<string, string>;
    context?: PullRunOptions["context"];
  }): string {
    return template.replace(TEMPLATE_PATTERN, (match, path) => {
      const segments = (path as string).split(".");
      const root = segments[0];
      const rest = segments.slice(1);
      const value = this.templateValue({ root, rest, credentials, context });
      if (value === undefined || value === null) {
        // Unresolved template var — leave the original match in place
        // so the failure surfaces to the operator (4xx with a clear
        // body, rather than a silent empty header).
        return match;
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }

  private templateValue({
    root,
    rest,
    credentials,
    context,
  }: {
    root: string | undefined;
    rest: string[];
    credentials: Record<string, string>;
    context?: PullRunOptions["context"];
  }): unknown {
    if (root === "credentials") {
      return rest.reduce<unknown>(
        (acc, seg) =>
          typeof acc === "object" && acc !== null
            ? Object.entries(acc).find(([key]) => key === seg)?.[1]
            : undefined,
        credentials,
      );
    }

    if (root !== "ingestionSource" || !context) return undefined;
    if (rest[0] === "organizationId") return context.organizationId;
    if (rest[0] === "id") return context.ingestionSourceId;
    return undefined;
  }

  private extractEvents({
    body,
    config,
  }: {
    body: unknown;
    config: HttpPollingConfig;
  }): NormalizedPullEvent[] {
    const eventsValue = JSONPath({
      path: config.eventsJsonPath,
      json: body as object,
      wrap: false,
    }) as unknown;
    if (!Array.isArray(eventsValue)) {
      this.diagnostics.warn("eventsJsonPath did not resolve to an array; treating as zero events", {
        adapter: this.id,
        eventsJsonPath: config.eventsJsonPath,
        actualType: typeof eventsValue,
      });
      return [];
    }
    return eventsValue.map((evt) => this.mapEvent(evt, config));
  }

  private mapEvent(rawEvent: unknown, config: HttpPollingConfig): NormalizedPullEvent {
    const extras: Record<string, unknown> = {};
    if (config.eventMapping.extra) {
      for (const [k, path] of Object.entries(config.eventMapping.extra)) {
        extras[k] = mappedValue(rawEvent, path);
      }
    }

    return {
      source_event_id: asString(mappedValue(rawEvent, config.eventMapping.source_event_id)),
      event_timestamp: asString(mappedValue(rawEvent, config.eventMapping.event_timestamp)),
      actor: asString(mappedValue(rawEvent, config.eventMapping.actor)),
      action: asString(mappedValue(rawEvent, config.eventMapping.action)),
      target: asString(mappedValue(rawEvent, config.eventMapping.target)),
      cost_usd: asDecimalString(mappedValue(rawEvent, config.eventMapping.cost_usd)),
      tokens_input: asInt(mappedValue(rawEvent, config.eventMapping.tokens_input)),
      tokens_output: asInt(mappedValue(rawEvent, config.eventMapping.tokens_output)),
      raw_payload: JSON.stringify(rawEvent),
      ...(Object.keys(extras).length > 0 ? { extra: extras } : {}),
    };
  }

  private extractCursor({
    body,
    config,
  }: {
    body: unknown;
    config: HttpPollingConfig;
  }): string | null {
    const cursor = JSONPath({
      path: config.cursorJsonPath,
      json: body as object,
      wrap: false,
    }) as unknown;
    if (cursor === undefined || cursor === null || cursor === "") {
      return null;
    }
    return typeof cursor === "string" ? cursor : JSON.stringify(cursor);
  }
}
