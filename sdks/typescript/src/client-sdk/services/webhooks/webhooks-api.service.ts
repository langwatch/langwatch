import { scopedApiKey } from "@/internal/credentialContext";
import {
  CURSOR_WALK_PAGE_SIZE,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { resolveEndpoint } from "@/internal/endpoint";

export interface WebhookEndpointSummary {
  id: string;
  url: string;
  max_batch_size: number;
  max_batch_delay_ms: number;
  max_in_flight: number;
  enabled_events: string[];
  status: "active" | "disabled";
  disabled_reason: string | null;
  disabled_at: string | null;
  failing_since: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpointSummary {
  /** Present only on create and roll-secret responses; never again. */
  secret: string;
}

/** The POST body, exactly as the wire takes it. */
export interface CreateWebhookEndpointInput {
  url: string;
  enabled_events: string[];
  description?: string;
  /** Envelopes per delivery. The receiver always gets an array. */
  max_batch_size?: number;
  /** How long a partial batch waits for company before it is sent. */
  max_batch_delay_ms?: number;
  /** Concurrent in-flight deliveries to this endpoint. */
  max_in_flight?: number;
}

/** The PATCH body, exactly as the wire takes it. Omitted fields are left alone. */
export interface UpdateWebhookEndpointInput {
  url?: string;
  enabled_events?: string[];
  description?: string | null;
  status?: "active" | "disabled";
  max_batch_size?: number;
  max_batch_delay_ms?: number;
  max_in_flight?: number;
}

export interface WebhookDeliveryRecord {
  id: string;
  dispatch_id: string;
  attempt: number;
  event_count: number;
  outcome: string;
  response_status: number | null;
  latency_ms: number | null;
  error: string | null;
  fired_at: string;
}

export interface WebhookTestResult {
  delivered: boolean;
  response_status: number | null;
  response_body?: string;
  error?: string;
}

export interface WebhookEndpointHealth {
  status: "active" | "disabled";
  disabled_reason: string | null;
  failing_since: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  /** The headline: age of the oldest envelope still buffered or retrying;
   *  null when the feed is fully delivered. */
  oldest_undelivered_age_ms: number | null;
  dlq_depth: number;
  sends_per_minute: number;
  success_rate: number | null;
  p95_latency_ms: number | null;
}

export interface WebhookEventType {
  type: string;
  family: string;
  schema_version: string;
  is_emitting: boolean;
  description: string;
}

export interface EmittedEvent {
  id: string;
  type: string;
  created: string;
  schema_version: string;
  data: Record<string, unknown>;
}

/** One page of the organization's emitted-events log. */
export interface EmittedEventsPage {
  data: EmittedEvent[];
  /** Pass back as `cursor` for the next page; null ends the walk. */
  next_cursor: string | null;
}

/** One page of an endpoint's delivery log, newest first. */
export interface WebhookDeliveryPage {
  data: WebhookDeliveryRecord[];
  /** Pass back as `cursor` for the next page; null ends the walk. */
  next_cursor: string | null;
}

export class WebhooksApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "WebhooksApiError";
  }
}

/**
 * Client for the org-anchored webhook platform surface (/api/webhooks/v1).
 * Authenticates with an ORGANIZATION API key (sk-lw-*); project keys are
 * rejected by the server. The surface is anchored on the organization alone,
 * so there is no project id to give this client.
 *
 * The endpoint entity and the create/update bodies mirror the wire verbatim,
 * so their fields are lowercase snake_case: virtual keys and gateway budgets
 * already take the wire body as it is, and translating field by field here
 * only made the request bodies of the four billing surfaces disagree. Call
 * options this SDK invents (query filters, per-call behaviour, action
 * arguments) stay camelCase like the rest of the SDK.
 */
export class WebhooksApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = resolveEndpoint(config?.endpoint);
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private async request<T>(
    operation: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      // A hung control plane must fail the command, not freeze it.
      signal: init?.signal ?? AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = await response.text();
      }
      const message = formatApiErrorForOperation({
        operation,
        error: parsedBody,
        options: { status: response.status },
      });
      throwIfHandledError({
        operation,
        error: parsedBody,
        status: response.status,
        message,
      });
      throw new WebhooksApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(): Promise<WebhookEndpointSummary[]> {
    const res = await this.request<{ data: WebhookEndpointSummary[] }>(
      "list webhook endpoints",
      "/api/webhooks/v1/endpoints",
    );
    return res.data;
  }

  async get(id: string): Promise<WebhookEndpointSummary> {
    const res = await this.request<{ data: WebhookEndpointSummary }>(
      "get webhook endpoint",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /** The signing secret comes back on this response and never again. */
  async create(
    input: CreateWebhookEndpointInput,
  ): Promise<WebhookEndpointWithSecret> {
    const res = await this.request<{ data: WebhookEndpointWithSecret }>(
      "create webhook endpoint",
      "/api/webhooks/v1/endpoints",
      { method: "POST", body: JSON.stringify(input) },
    );
    return res.data;
  }

  async update(
    id: string,
    input: UpdateWebhookEndpointInput,
  ): Promise<WebhookEndpointSummary> {
    const res = await this.request<{ data: WebhookEndpointSummary }>(
      "update webhook endpoint",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return res.data;
  }

  /**
   * Retire an endpoint: the server soft-archives the row, stamping
   * `archived_at` and dropping the status to disabled, so the delivery
   * history stays readable for audit while nothing more is ever sent. The
   * row is archived, not removed, and `gatewayBudgets.archive()` already
   * names that operation, so the billing surfaces agree on the verb.
   *
   * Nothing comes back: the response body carries only an `archived: true`
   * acknowledgement, and a non-2xx already raises.
   */
  async archive(id: string): Promise<void> {
    await this.request<unknown>(
      "archive webhook endpoint",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  async rollSecret(id: string): Promise<WebhookEndpointWithSecret> {
    const res = await this.request<{ data: WebhookEndpointWithSecret }>(
      "roll webhook endpoint secret",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}/roll-secret`,
      { method: "POST" },
    );
    return res.data;
  }

  async test(id: string): Promise<WebhookTestResult> {
    const res = await this.request<{ data: WebhookTestResult }>(
      "test webhook endpoint",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    );
    return res.data;
  }

  /**
   * ONE page of the endpoint's delivery attempts, newest first.
   *
   * The cursor is why this is a page: the route has always served one, and
   * dropping it truncated the delivery log at whatever the first page held,
   * with nothing in the result to say the rest existed. Pass `next_cursor`
   * back as `cursor`, or walk the whole log with `iterDeliveries()`.
   */
  async deliveriesPage(
    id: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<WebhookDeliveryPage> {
    const params = new URLSearchParams();
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const { data, next_cursor } = await this.request<{
      data: WebhookDeliveryRecord[];
      next_cursor?: string | null;
    }>(
      "list webhook deliveries",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}/deliveries${qs}`,
    );
    return { data, next_cursor: next_cursor ?? null };
  }

  /**
   * Every recorded delivery attempt for the endpoint, one at a time,
   * fetching each page only when the consumer reaches it.
   */
  async *iterDeliveries(
    id: string,
    options?: { cursor?: string; limit?: number },
  ): AsyncGenerator<WebhookDeliveryRecord> {
    const pages = walkCursorPages<WebhookDeliveryPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new WebhooksApiError(
          `Failed to list webhook deliveries: ${reason}.`,
          "list webhook deliveries",
        ),
      fetchPage: (cursor) =>
        this.deliveriesPage(id, {
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
  }

  async health(id: string): Promise<WebhookEndpointHealth> {
    const res = await this.request<{ data: WebhookEndpointHealth }>(
      "read webhook endpoint health",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}/health`,
    );
    return res.data;
  }

  async eventTypes(): Promise<WebhookEventType[]> {
    const res = await this.request<{ data: WebhookEventType[] }>(
      "list webhook event types",
      "/api/webhooks/v1/event-types",
    );
    return res.data;
  }

  /**
   * ONE page of the organization's emitted-events log, newest first.
   *
   * Webhooks are a push over this log, never the only copy of it: a consumer
   * that missed a delivery reads the window back from here. Walk the whole
   * window with `iterEvents()`.
   */
  async eventsPage(options?: {
    type?: string;
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
  }): Promise<EmittedEventsPage> {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.from !== undefined) params.set("from", String(options.from));
    if (options?.to !== undefined) params.set("to", String(options.to));
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const { data, next_cursor } = await this.request<{
      data: EmittedEvent[];
      next_cursor?: string | null;
    }>("list emitted events", `/api/webhooks/v1/events${qs}`);
    return { data, next_cursor: next_cursor ?? null };
  }

  /**
   * Every emitted event matching the filter, one at a time, fetching each
   * page only when the consumer reaches it.
   */
  async *iterEvents(options?: {
    type?: string;
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
  }): AsyncGenerator<EmittedEvent> {
    const pages = walkCursorPages<EmittedEventsPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new WebhooksApiError(
          `Failed to list emitted events: ${reason}.`,
          "list emitted events",
        ),
      fetchPage: (cursor) =>
        this.eventsPage({
          ...options,
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
  }

  /**
   * One emitted event by id, the envelope exactly as it was delivered.
   *
   * A 404 covers every reason the log cannot answer: never emitted, past the
   * retention horizon, or belonging to another organization.
   */
  async getEvent(id: string): Promise<EmittedEvent> {
    const res = await this.request<{ data: EmittedEvent }>(
      "get emitted event",
      `/api/webhooks/v1/events/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
