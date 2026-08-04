import { scopedApiKey } from "@/internal/credentialContext";
import {
  CURSOR_WALK_PAGE_SIZE,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { resolveEndpoint } from "@/internal/endpoint";

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

export interface SpendSummariesPage {
  data: SpendSummaryRow[];
  /**
   * Pass back as `cursor` for the next page; null means the walk is done.
   * A full page does NOT mean there is more, so follow this until null
   * rather than stopping when a page comes back short.
   */
  next_cursor: string | null;
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
  on_breach: "block" | "warn";
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
 *
 * Entity types mirror the wire verbatim, so their fields are lowercase
 * snake_case. Call options this SDK invents (query filters, per-call
 * behaviour, action arguments) are camelCase like the rest of the SDK.
 *
 * There is no project id here: `/spend-summaries` takes `project_id` as a
 * query filter rather than scoping on a header, so the project belongs to the
 * call, not to the client.
 *
 * Neither collection on this service offers an eager whole-set read. The
 * ledger is unbounded, and materialising a window of it is the very
 * under-counting and out-of-memory footgun the page docstrings warn about:
 * take pages, or stream with `iterate()` / `iterSummaries()`.
 */
export class SpendEventsApiService {
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
      throw new SpendEventsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  /**
   * ONE page of the per-request spend ledger for a window. Pass `next_cursor`
   * back as `cursor` for the next page, verbatim.
   *
   * A full page does NOT mean there is more and a short page does NOT mean
   * there is no more: only a null cursor ends the walk. A reconciler that
   * stops on the first page silently under-counts the window, so read every
   * page or stream them with `iterate()`.
   */
  async listPage(options: {
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

  /**
   * Every spend event in the window, one row at a time, fetching each page
   * only when the consumer reaches it.
   *
   * This is how a reconciler reads a whole window without holding it: the
   * ledger is unbounded, so there is deliberately no eager `list()` to
   * collect it into an array. Raises rather than looping forever on a cursor
   * chain that never ends.
   */
  async *iterate(options: {
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
  }): AsyncGenerator<SpendEvent> {
    const pages = walkCursorPages<SpendEventsPage>({
      startCursor: options.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new SpendEventsApiError(
          `Failed to list spend events: ${reason}.`,
          "list spend events",
        ),
      fetchPage: (cursor) =>
        this.listPage({
          ...options,
          cursor,
          limit: options.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
  }

  /**
   * ONE page of per-key spend rollups for a window, paged by group key
   * ascending.
   *
   * The page is a step of a walk, not a whole answer: follow `next_cursor`
   * until it comes back null, or stream the walk with `iterSummaries()`. A
   * reconciler that reads only the first page silently under-counts every
   * tenant past the limit.
   */
  async summariesPage(options: {
    groupBy: "virtual_key" | "end_user";
    from: number;
    to: number;
    projectId?: string;
    /** Narrow the rollup to one key, exact match. */
    virtualKeyId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<SpendSummariesPage> {
    const params = new URLSearchParams();
    params.set("group_by", options.groupBy);
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.virtualKeyId)
      params.set("virtual_key_id", options.virtualKeyId);
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    return await this.request<SpendSummariesPage>(
      "read spend summaries",
      `/api/gateway/v1/spend-summaries?${params.toString()}`,
    );
  }

  /**
   * Every rollup row for the window, one at a time, fetching each page only
   * when the consumer reaches it.
   *
   * The rollup has one row per tenant seen in the window, which no bound
   * covers, so there is deliberately no eager whole-set read here either: a
   * checksum that quietly covers part of the window is worse than none.
   */
  async *iterSummaries(options: {
    groupBy: "virtual_key" | "end_user";
    from: number;
    to: number;
    projectId?: string;
    /** Narrow the rollup to one key, exact match. */
    virtualKeyId?: string;
    cursor?: string;
    limit?: number;
  }): AsyncGenerator<SpendSummaryRow> {
    const pages = walkCursorPages<SpendSummariesPage>({
      startCursor: options.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new SpendEventsApiError(
          `Failed to read spend summaries: ${reason}.`,
          "read spend summaries",
        ),
      fetchPage: (cursor) =>
        this.summariesPage({
          ...options,
          cursor,
          limit: options.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
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
