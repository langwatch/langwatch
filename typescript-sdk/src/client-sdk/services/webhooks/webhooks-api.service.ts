import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { trimTrailingSlashes } from "@/internal/url";

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
 * rejected by the server.
 */
export class WebhooksApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = trimTrailingSlashes(
      config?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      DEFAULT_ENDPOINT,
    );
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
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

  async create(input: {
    url: string;
    enabledEvents: string[];
  }): Promise<WebhookEndpointWithSecret> {
    const res = await this.request<{ data: WebhookEndpointWithSecret }>(
      "create webhook endpoint",
      "/api/webhooks/v1/endpoints",
      {
        method: "POST",
        body: JSON.stringify({
          url: input.url,
          enabled_events: input.enabledEvents,
        }),
      },
    );
    return res.data;
  }

  async update(
    id: string,
    input: {
      url?: string;
      enabledEvents?: string[];
      status?: "active" | "disabled";
      maxBatchSize?: number;
      maxBatchDelayMs?: number;
      maxInFlight?: number;
    },
  ): Promise<WebhookEndpointSummary> {
    const res = await this.request<{ data: WebhookEndpointSummary }>(
      "update webhook endpoint",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.enabledEvents !== undefined
            ? { enabled_events: input.enabledEvents }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.maxBatchSize !== undefined
            ? { max_batch_size: input.maxBatchSize }
            : {}),
          ...(input.maxBatchDelayMs !== undefined
            ? { max_batch_delay_ms: input.maxBatchDelayMs }
            : {}),
          ...(input.maxInFlight !== undefined
            ? { max_in_flight: input.maxInFlight }
            : {}),
        }),
      },
    );
    return res.data;
  }

  async delete(id: string): Promise<void> {
    await this.request<unknown>(
      "delete webhook endpoint",
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

  async deliveries(
    id: string,
    options?: { limit?: number },
  ): Promise<WebhookDeliveryRecord[]> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const res = await this.request<{ data: WebhookDeliveryRecord[] }>(
      "list webhook deliveries",
      `/api/webhooks/v1/endpoints/${encodeURIComponent(id)}/deliveries${qs}`,
    );
    return res.data;
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

  async events(options?: {
    type?: string;
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: EmittedEvent[]; next_cursor: string | null }> {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.from !== undefined) params.set("from", String(options.from));
    if (options?.to !== undefined) params.set("to", String(options.to));
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    return await this.request<{
      data: EmittedEvent[];
      next_cursor: string | null;
    }>("list emitted events", `/api/webhooks/v1/events${qs}`);
  }
}
