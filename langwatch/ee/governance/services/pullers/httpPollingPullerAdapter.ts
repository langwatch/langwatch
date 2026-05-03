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
import type { Response as FetchResponse } from "undici";
import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { createLogger } from "~/utils/logger/server";

import type {
  NormalizedPullEvent,
  PullResult,
  PullRunOptions,
  PullerAdapter,
} from "./pullerAdapter";

const logger = createLogger("langwatch:puller:http_polling");

const TEMPLATE_PATTERN = /\$\{\{([\w.]+)\}\}/g;
const RETRY_DELAYS_MS = [250, 500] as const;
const MAX_PAGES_PER_RUN = 50; // safety cap so a misconfigured cursor doesn't loop forever
const REQUEST_TIMEOUT_MS = 30_000;

const eventMappingSchema = z.object({
  source_event_id: z.string().min(1),
  event_timestamp: z.string().min(1),
  actor: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  cost_usd: z.string().optional(),
  tokens_input: z.string().optional(),
  tokens_output: z.string().optional(),
  extra: z.record(z.string()).optional(),
});

const httpPollingConfigSchema = z.object({
  adapter: z.literal("http_polling"),
  url: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string()).default({}),
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
  /** cron string for scheduling (validated upstream by BullMQ). */
  schedule: z.string().min(1),
  /** Per-event JSONPath mappings (NormalizedPullEvent shape). */
  eventMapping: eventMappingSchema,
});

export type HttpPollingConfig = z.infer<typeof httpPollingConfigSchema>;

export class HttpPollingPullerAdapter
  implements PullerAdapter<HttpPollingConfig>
{
  readonly id = "http_polling";

  validateConfig(config: unknown): HttpPollingConfig {
    return httpPollingConfigSchema.parse(config);
  }

  async runOnce(
    options: PullRunOptions,
    config: HttpPollingConfig,
  ): Promise<PullResult> {
    const allEvents: NormalizedPullEvent[] = [];
    let cursor = options.cursor;
    let pageCount = 0;

    while (pageCount < MAX_PAGES_PER_RUN) {
      pageCount += 1;
      if (
        options.deadlineMs !== undefined &&
        Date.now() > options.deadlineMs
      ) {
        logger.info(
          { adapter: this.id, pageCount, cursor },
          "Deadline reached mid-pagination, returning cursor for next run",
        );
        return { events: allEvents, cursor, errorCount: 0 };
      }

      let response: FetchResponse;
      try {
        response = await this.fetchPage({ config, cursor, options });
      } catch (error) {
        logger.error(
          {
            adapter: this.id,
            url: config.url,
            cursor,
            error: error instanceof Error ? error.message : String(error),
          },
          "HttpPollingPullerAdapter: fetch failed (all retries exhausted)",
        );
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
    logger.warn(
      {
        adapter: this.id,
        url: config.url,
        pageCount,
        cursor,
      },
      "HttpPollingPullerAdapter: hit MAX_PAGES_PER_RUN safety cap",
    );
    return { events: allEvents, cursor, errorCount: 0 };
  }

  private async fetchPage({
    config,
    cursor,
    options,
  }: {
    config: HttpPollingConfig;
    cursor: string | null;
    options: PullRunOptions;
  }): Promise<FetchResponse> {
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

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await ssrfSafeFetch(url, {
          method: config.method,
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status >= 500) {
          // Retryable — fall through to the retry-delay branch
          lastError = new Error(
            `HTTP ${response.status} ${response.statusText}`,
          );
        } else if (response.status >= 400) {
          // 4xx fails fast — no retry
          throw new Error(
            `HTTP ${response.status} ${response.statusText} (${url})`,
          );
        } else {
          return response;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // 4xx errors land here too (re-thrown above); only retry on
        // network/transport errors and 5xx
        if (
          error instanceof Error &&
          /^HTTP 4\d{2}/.test(error.message)
        ) {
          throw error;
        }
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && attempt < RETRY_DELAYS_MS.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError ?? new Error("HttpPollingPullerAdapter: unknown error");
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
    if (config.authMode === "bearer" && credentials.token) {
      // Inject standard Authorization header. If the caller already
      // declared one in `headers`, theirs wins.
      if (!("Authorization" in headers) && !("authorization" in headers)) {
        headers.Authorization = `Bearer ${credentials.token}`;
      }
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
      let value: unknown;
      if (root === "credentials") {
        value = rest.reduce<unknown>(
          (acc, seg) =>
            typeof acc === "object" && acc !== null
              ? (acc as Record<string, unknown>)[seg]
              : undefined,
          credentials,
        );
      } else if (root === "ingestionSource" && context) {
        if (rest[0] === "organizationId") value = context.organizationId;
        else if (rest[0] === "id") value = context.ingestionSourceId;
      }
      if (value === undefined || value === null) {
        // Unresolved template var — leave the original match in place
        // so the failure surfaces to the operator (4xx with a clear
        // body, rather than a silent empty header).
        return match;
      }
      return String(value);
    });
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
      logger.warn(
        {
          adapter: this.id,
          eventsJsonPath: config.eventsJsonPath,
          actualType: typeof eventsValue,
        },
        "eventsJsonPath did not resolve to an array; treating as zero events",
      );
      return [];
    }
    return eventsValue.map((evt) => this.mapEvent(evt, config));
  }

  private mapEvent(
    rawEvent: unknown,
    config: HttpPollingConfig,
  ): NormalizedPullEvent {
    const get = (path: string | undefined): unknown =>
      path === undefined
        ? undefined
        : (JSONPath({
            path,
            json: rawEvent as object,
            wrap: false,
          }) as unknown);

    const asString = (v: unknown): string =>
      v === undefined || v === null ? "" : String(v);
    const asNumber = (v: unknown): number => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const asInt = (v: unknown): number => Math.trunc(asNumber(v));

    const extras: Record<string, unknown> = {};
    if (config.eventMapping.extra) {
      for (const [k, path] of Object.entries(config.eventMapping.extra)) {
        extras[k] = get(path);
      }
    }

    return {
      source_event_id: asString(get(config.eventMapping.source_event_id)),
      event_timestamp: asString(get(config.eventMapping.event_timestamp)),
      actor: asString(get(config.eventMapping.actor)),
      action: asString(get(config.eventMapping.action)),
      target: asString(get(config.eventMapping.target)),
      cost_usd: asNumber(get(config.eventMapping.cost_usd)),
      tokens_input: asInt(get(config.eventMapping.tokens_input)),
      tokens_output: asInt(get(config.eventMapping.tokens_output)),
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
    return String(cursor);
  }
}
