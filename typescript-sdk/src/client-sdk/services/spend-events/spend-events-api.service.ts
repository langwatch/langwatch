import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface SpendEvent {
  id: string;
  type: string;
  created: string;
  schema_version: string;
  data: {
    /** Type-suffixed, unique per (request, event type): a settled and a
     *  completed event for one request never share an id. */
    event_id: string;
    /** "gateway.request.completed" (confirmed and failed outcomes) or
     *  "gateway.request.settled" (confirmation never arrived). */
    event_type: string;
    /** The join key across a settled/completed pair: a completed event
     *  SUPERSEDES an earlier settled one for the same request; replace the
     *  figure, never sum the pair. */
    gateway_request_id: string;
    occurred_at: string;
    organization_id: string;
    project_id: string;
    virtual_key_id: string;
    principal_user_id: string | null;
    end_user_id: string | null;
    trace_id: string;
    model: string | null;
    model_provider_id: string | null;
    request_type: string | null;
    /** Null on settled events: unknown is not zero. */
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      reasoning_tokens: number;
    } | null;
    /** Null on settled events: unknown is not zero. */
    cost: {
      total_usd: string;
      nano_usd: number;
      rate_version: string | null;
    } | null;
    /** "success" | "error" on completed events, "settled" on settled ones. */
    status: string;
    needs_reconciliation: boolean | null;
    settle_reason: string | null;
    error: { class: string; http_status: number | null } | null;
    duration_ms: number | null;
    labels: string[];
    metadata: Record<string, unknown>;
  };
}

export interface SpendSummaryRow {
  key: string;
  /** Priced outcomes (confirmed and failed). */
  event_count: number;
  /** Unpriced settled requests, counted separately: never in cost sums. */
  settled_count: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    reasoning_tokens: number;
  };
  cost: { total_usd: string; nano_usd: number };
}

export interface SpendSummariesResponse {
  data: SpendSummaryRow[];
}

export interface SpendEventsPage {
  data: SpendEvent[];
  next_cursor: string | null;
}

export interface SpendReplayResult {
  endpoint_id: string;
  replay_id: string;
  replayed: number;
  window: { from: string; to: string };
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
  /**
   * The attributed-user template caps that apply to this end user, each
   * with its boundary-aware current-period spend. Empty when the
   * organization runs no templates; never null.
   */
  caps: EndUserCap[];
}

export interface EndUserCap {
  budget_id: string;
  anchor_id: string;
  window: string;
  on_breach: "BLOCK" | "WARN";
  limit_usd: string;
  spent_usd: string;
  period_started_at: string;
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
      throw new SpendEventsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(options: {
    /** Required: the pull is a ranged read by contract. */
    from: number;
    to: number;
    cursor?: string;
    limit?: number;
    virtualKeyId?: string;
    endUserId?: string;
    projectId?: string;
    model?: string;
    status?: "success" | "error";
  }): Promise<SpendEventsPage> {
    const params = new URLSearchParams();
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.virtualKeyId) params.set("virtual_key_id", options.virtualKeyId);
    if (options.endUserId) params.set("end_user_id", options.endUserId);
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.model) params.set("model", options.model);
    if (options.status) params.set("status", options.status);
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    return await this.request<SpendEventsPage>(
      "list spend events",
      `/api/gateway/v1/spend-events${qs}`,
    );
  }

  async summaries(options: {
    groupBy: "virtual_key" | "end_user";
    from: number;
    to: number;
    projectId?: string;
    limit?: number;
  }): Promise<SpendSummariesResponse> {
    const params = new URLSearchParams();
    params.set("group_by", options.groupBy);
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    return await this.request<SpendSummariesResponse>(
      "read spend summaries",
      `/api/gateway/v1/spend-summaries?${params.toString()}`,
    );
  }

  /**
   * Re-deliver a window's spend envelopes to ONE endpoint through the
   * normal delivery path. Envelope ids are unchanged (your consumer's
   * dedup key); mind your downstream billing system's finite dedup
   * window before replaying old ranges. The window is capped server-side
   * at 7 days per call.
   */
  async replay(options: {
    from: number;
    to: number;
    endpointId: string;
  }): Promise<SpendReplayResult> {
    const response = await this.request<{ data: SpendReplayResult }>(
      "replay spend events",
      "/api/gateway/v1/spend-events/replay",
      {
        method: "POST",
        body: JSON.stringify({
          from: options.from,
          to: options.to,
          endpoint_id: options.endpointId,
        }),
      },
    );
    return response.data;
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
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const res = await this.request<{ data: EndUserSpend }>(
      "read end-user spend",
      `/api/gateway/v1/end-users/${encodeURIComponent(endUserId)}/spend${qs}`,
    );
    return res.data;
  }
}
