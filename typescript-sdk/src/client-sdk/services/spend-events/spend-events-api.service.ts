import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface SpendEvent {
  id: string;
  type: string;
  created: string;
  schema_version: string;
  data: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    organization_id: string;
    project_id: string;
    virtual_key_id: string;
    principal_user_id: string | null;
    end_user_id: string | null;
    trace_id: string;
    model: string;
    model_provider_id: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      reasoning_tokens: number;
    };
    cost: { total_usd: string; nano_usd?: number; rate_version?: string | null };
    status: string;
    error: { class: string; http_status: number | null } | null;
    duration_ms: number;
    labels: string[];
    metadata: Record<string, unknown>;
  };
}

export interface SpendEventsPage {
  data: SpendEvent[];
  next_cursor: string | null;
}

export interface EndUserSpend {
  end_user_id: string;
  window: string;
  from: string;
  to: string;
  cost: { total_usd: string; nano_usd?: number };
  request_count: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    reasoning_tokens: number;
  };
  cap: unknown;
}

export class SpendEventsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "SpendEventsApiError";
  }
}

/**
 * Client for the gateway spend reconciliation surface (/api/gateway/v1).
 * Authenticates with an ORGANIZATION API key (sk-lw-*).
 */
export class SpendEventsApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = (
      config?.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      DEFAULT_ENDPOINT
    ).replace(/\/+$/, "");
    this.apiKey =
      config?.apiKey ??
      process.env.LANGWATCH_ORG_API_KEY ??
      process.env.LANGWATCH_API_KEY ??
      "";
  }

  private async request<T>(
    operation: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
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
      throw new SpendEventsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(options?: {
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
    virtualKeyId?: string;
    endUserId?: string;
    projectId?: string;
    model?: string;
    status?: "success" | "error";
  }): Promise<SpendEventsPage> {
    const params = new URLSearchParams();
    if (options?.from !== undefined) params.set("from", String(options.from));
    if (options?.to !== undefined) params.set("to", String(options.to));
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.virtualKeyId) params.set("virtual_key_id", options.virtualKeyId);
    if (options?.endUserId) params.set("end_user_id", options.endUserId);
    if (options?.projectId) params.set("project_id", options.projectId);
    if (options?.model) params.set("model", options.model);
    if (options?.status) params.set("status", options.status);
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    return await this.request<SpendEventsPage>(
      "list spend events",
      `/api/gateway/v1/spend-events${qs}`,
    );
  }

  async endUserSpend(
    endUserId: string,
    options?: {
      window?: "day" | "week" | "month";
      from?: number;
      to?: number;
      virtualKeyId?: string;
    },
  ): Promise<EndUserSpend> {
    const params = new URLSearchParams();
    if (options?.window) params.set("window", options.window);
    if (options?.from !== undefined) params.set("from", String(options.from));
    if (options?.to !== undefined) params.set("to", String(options.to));
    if (options?.virtualKeyId) params.set("virtual_key_id", options.virtualKeyId);
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    const res = await this.request<{ data: EndUserSpend }>(
      "read end-user spend",
      `/api/gateway/v1/end-users/${encodeURIComponent(endUserId)}/spend${qs}`,
    );
    return res.data;
  }
}
