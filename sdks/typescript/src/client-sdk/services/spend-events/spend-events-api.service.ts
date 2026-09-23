import {
  CURSOR_WALK_PAGE_SIZE,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { mergeHeaders } from "@/client-sdk/services/_shared/merge-headers";
import { mutationInit, type MutationOptions } from "@/client-sdk/services/_shared/mutation-options";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/**
 * The quantities one priced request or rollup carries; every field is
 * always present (0 when unused) and buckets are disjoint, not nested.
 * `reasoning_tokens` and `image_count` are subsets already priced elsewhere.
 */
export interface SpendUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_tokens: number;
  input_image_tokens: number;
  output_image_tokens: number;
  image_count: number;
}

/**
 * Fills image quantities a server older than the release that added them
 * won't send — defaults them to 0 rather than handing a caller `undefined`
 * mid-spend-page.
 */
function spendUsageFromWire(usage: SpendUsage): SpendUsage {
  const wire = usage as Partial<SpendUsage>;
  return {
    ...usage,
    input_image_tokens: wire.input_image_tokens ?? 0,
    output_image_tokens: wire.output_image_tokens ?? 0,
    image_count: wire.image_count ?? 0,
  };
}

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
    usage: SpendUsage | null;
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
  /**
   * The FIRST grouping dimension's value. Unchanged from when a rollup could
   * only be grouped one way, so existing code keeps reading what it did. With
   * two dimensions, two rows can share a key: read `group` to tell them apart.
   */
  key: string;
  /** Every grouping dimension by name, e.g. `{ model: "gpt-5-mini" }`. */
  group: Record<string, string>;
  /** Start of the time bucket in the requested zone, null when unbucketed. */
  bucket_start: string | null;
  /** Priced outcomes (confirmed and failed). */
  event_count: number;
  /** Unpriced settled requests, counted separately: never in cost sums. */
  settled_count: number;
  usage: SpendUsage;
  cost: { total_usd: string; nano_usd: number };
}

/** Request states: admitted at start, confirmed/failed/settled at end. */
export type SpendEventStatus =
  | "success"
  | "error"
  | "admitted"
  | "confirmed"
  | "failed"
  | "settled";

/** Rollup states: excludes admitted (no cost yet). Use events for those. */
export type SpendSummaryStatus = Exclude<SpendEventStatus, "admitted">;

/** A dimension a rollup can be grouped by. */
export type SpendGroupBy =
  | "virtual_key"
  | "end_user"
  | "project"
  | "model"
  | "provider"
  | "principal"
  | "request_type";

/**
 * Shared filters for spend reads. Every field takes one value or many.
 * Multiple values widen; multiple fields narrow.
 */
export interface SpendFilterOptions {
  projectId?: string | string[];
  /** Resolved to the projects the team owns. A team with none matches nothing. */
  teamId?: string | string[];
  /** Your own id for a virtual key. One nobody minted matches nothing. */
  externalId?: string | string[];
  virtualKeyId?: string | string[];
  endUserId?: string | string[];
  principalUserId?: string | string[];
  model?: string | string[];
  providerKey?: string | string[];
  requestType?: string | string[];
  label?: string | string[];
  /**
   * Your own request metadata, e.g. `{ customer_tier: "gold" }`. Several
   * values for one key widen it; several keys narrow.
   */
  metadata?: Record<string, string | string[]>;
  status?: SpendEventStatus;
}

const FILTER_PARAMS: readonly [keyof SpendFilterOptions, string][] = [
  ["projectId", "project_id"],
  ["teamId", "team_id"],
  ["externalId", "external_id"],
  ["virtualKeyId", "virtual_key_id"],
  ["endUserId", "end_user_id"],
  ["principalUserId", "principal_user_id"],
  ["model", "model"],
  ["providerKey", "provider_key"],
  ["requestType", "request_type"],
  ["label", "label"],
];

/** Repeat the parameter once per value: that is how the API widens a filter. */
function appendSpendFilters({
  params,
  filters,
}: {
  params: URLSearchParams;
  filters: SpendFilterOptions;
}): void {
  for (const [field, name] of FILTER_PARAMS) {
    const value = filters[field] as string | string[] | undefined;
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      params.append(name, one);
    }
  }
  for (const [key, value] of Object.entries(filters.metadata ?? {})) {
    // The API splits a pair on its FIRST colon, so a key carrying one would
    // silently address a different key and report spend for a filter nobody
    // wrote. Refused here rather than sent and misread.
    if (key.includes(":")) {
      throw new SpendEventsApiError(
        `A metadata key cannot contain a colon: ${key}`,
        "build spend filters",
      );
    }
    for (const one of Array.isArray(value) ? value : [value]) {
      params.append("metadata", `${key}:${one}`);
    }
  }
  if (filters.status) params.set("status", filters.status);
}

/**
 * Grouping by model/provider/time is unstable: outcomes may arrive and change
 * the recorded values. Use allowUnstable for approximate live views; reconcile
 * closed periods to avoid this.
 */
export interface SpendSummariesOptions extends Omit<SpendFilterOptions, "status"> {
  /** Lifecycle status; excludes admitted (no cost yet). */
  status?: SpendSummaryStatus;
  /** One or two dimensions. Two rows can share `key`; read `group`. */
  groupBy: SpendGroupBy | SpendGroupBy[];
  from: number;
  to: number;
  /** Adds a time column. Counts as movable, so the same refusal applies. */
  bucket?: "none" | "hour" | "day";
  /** IANA zone the bucket boundary falls on, e.g. "Europe/Amsterdam". */
  timezone?: string;
  /** Serve a movable grouping anyway, accepting an inexact walk. */
  allowUnstable?: boolean;
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
  usage: SpendUsage;
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
 * Spend reconciliation service (/api/gateway/v1). Requires ORGANIZATION API
 * key (sk-lw-*). Use iterate/iterSummaries for large windows (no eager read).
 */
export class SpendEventsApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = resolveEndpoint(config?.endpoint);
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private async request<T>(operation: string, path: string, init?: RequestInit): Promise<T> {
    const response = await langwatchFetch(`${this.endpoint}${path}`, {
      ...init,
      // A hung control plane must fail the command, not freeze it.
      signal: init?.signal ?? AbortSignal.timeout(30_000),
      headers: mergeHeaders(
        { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        init?.headers,
      ),
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

  /** One page of events. Follow next_cursor or use iterate() for the full window. */
  async listPage(
    options: SpendFilterOptions & {
      /** Required: the pull is a ranged read by contract. */
      from: number;
      to: number;
      cursor?: string;
      limit?: number;
    },
  ): Promise<SpendEventsPage> {
    const params = new URLSearchParams();
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    appendSpendFilters({ params, filters: options });
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const page = await this.request<SpendEventsPage>(
      "list spend events",
      `/api/gateway/v1/spend-events${qs}`,
    );
    return {
      ...page,
      data: page.data.map((event) => ({
        ...event,
        data: {
          ...event.data,
          usage: event.data.usage === null ? null : spendUsageFromWire(event.data.usage),
        },
      })),
    };
  }

  /** Stream events without holding the whole window in memory. */
  async *iterate(
    options: SpendFilterOptions & {
      /** Required: the pull is a ranged read by contract. */
      from: number;
      to: number;
      cursor?: string;
      limit?: number;
    },
  ): AsyncGenerator<SpendEvent> {
    const pages = walkCursorPages<SpendEventsPage>({
      startCursor: options.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new SpendEventsApiError(`Failed to list spend events: ${reason}.`, "list spend events"),
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

  /** One page of rollups by group key. Use iterSummaries for the full walk. */
  async summariesPage(
    options: SpendSummariesOptions & { cursor?: string; limit?: number },
  ): Promise<SpendSummariesPage> {
    const params = new URLSearchParams();
    const groupBy = Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy];
    params.set("group_by", groupBy.join(","));
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.bucket) params.set("bucket", options.bucket);
    if (options.timezone) params.set("timezone", options.timezone);
    if (options.allowUnstable) params.set("allow_unstable", "true");
    appendSpendFilters({ params, filters: options });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const page = await this.request<SpendSummariesPage>(
      "read spend summaries",
      `/api/gateway/v1/spend-summaries?${params.toString()}`,
    );
    return {
      ...page,
      data: page.data.map((row) => ({
        ...row,
        usage: spendUsageFromWire(row.usage),
      })),
    };
  }

  /** Stream rollup rows without holding the whole window in memory. */
  async *iterSummaries(
    options: SpendSummariesOptions & { cursor?: string; limit?: number },
  ): AsyncGenerator<SpendSummaryRow> {
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

  /** Re-deliver spend envelopes to an endpoint (max 7 days). */
  async replay(
    options: {
      from: number;
      to: number;
      endpointId: string;
    } & MutationOptions,
  ): Promise<SpendReplayResult> {
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
        ...mutationInit(options),
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
    return { ...res.data, usage: spendUsageFromWire(res.data.usage) };
  }
}
