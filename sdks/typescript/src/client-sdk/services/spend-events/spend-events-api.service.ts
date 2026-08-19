import {
  CURSOR_WALK_PAGE_SIZE,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import {
  type MutationOptions,
  mutationInit,
} from "@/client-sdk/services/_shared/mutation-options";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { scopedApiKey } from "@/internal/credentialContext";
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
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    reasoning_tokens: number;
  };
  cost: { total_usd: string; nano_usd: number };
}

/**
 * The states a request can be filtered by, which is more than the two a
 * caller usually thinks in: a request is `admitted` when it starts,
 * `confirmed` or `failed` when it ends, and `settled` once its cost is final.
 * `success` and `error` are the coarse outcome pair over those.
 */
export type SpendEventStatus =
  | "success"
  | "error"
  | "admitted"
  | "confirmed"
  | "failed"
  | "settled";

/**
 * The states a ROLLUP can be filtered by. A rollup sums the cost of requests
 * past admission, so `admitted` is refused there rather than answered with a
 * zero; list the events to see those. Derived by exclusion so the two stay one
 * vocabulary.
 */
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
 * The filters BOTH spend reads accept. A reconciliation checksums the rollups
 * and diffs the events when a checksum disagrees, so the two take the same
 * vocabulary and a divergence can be walked on exactly the narrowing that
 * produced it.
 *
 * Every field takes one value or many; many means "any of these". Naming two
 * different fields narrows.
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

const FILTER_PARAMS: ReadonlyArray<[keyof SpendFilterOptions, string]> = [
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
 * What a rollup is grouped by, and over what window.
 *
 * Grouping by `model` or `provider`, or into time buckets, is REFUSED with
 * `gateway_spend_group_by_unstable` over a window recent enough that outcomes
 * can still arrive: until a request settles, the model and provider recorded
 * against it are the ones that were asked for, and they are replaced by the
 * ones that actually served it. A page walk over a group that can move counts
 * some requests twice and misses others.
 *
 * Reconcile closed periods and this never fires. For a live view where an
 * approximate shape is enough, send `allowUnstable`.
 */
export interface SpendSummariesOptions
  extends Omit<SpendFilterOptions, "status"> {
  /**
   * One lifecycle status, minus `admitted`: a rollup sums the cost of requests
   * past admission, and an admitted request has none yet. List the events for
   * those.
   */
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
 * The key MUST be an organization API key (`sk-lw-{id}_{secret}`, from
 * Settings > API Keys). A project API key is refused before any permission is
 * consulted, with `credential_class_mismatch`, and no header makes it work:
 * these are organization-scoped routes and a project key names one project.
 * The same organization key also reaches the project-scoped surfaces when
 * given `X-Project-Id`, so one key covers both families and a project key
 * covers only one.
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
    this.apiKey =
      config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
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
  async summariesPage(
    options: SpendSummariesOptions & { cursor?: string; limit?: number },
  ): Promise<SpendSummariesPage> {
    const params = new URLSearchParams();
    const groupBy = Array.isArray(options.groupBy)
      ? options.groupBy
      : [options.groupBy];
    params.set("group_by", groupBy.join(","));
    params.set("from", String(options.from));
    params.set("to", String(options.to));
    if (options.bucket) params.set("bucket", options.bucket);
    if (options.timezone) params.set("timezone", options.timezone);
    if (options.allowUnstable) params.set("allow_unstable", "true");
    appendSpendFilters({ params, filters: options });
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

  /**
   * Re-deliver a window's spend envelopes to ONE endpoint through the
   * normal delivery path. Envelope ids are unchanged (your consumer's
   * dedup key); mind your downstream billing system's finite dedup
   * window before replaying old ranges. The window is capped server-side
   * at 7 days per call.
   */
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
    if (options?.virtualKeyId)
      params.set("virtual_key_id", options.virtualKeyId);
    const qs = params.toString() !== "" ? `?${params.toString()}` : "";
    const res = await this.request<{ data: EndUserSpend }>(
      "read end-user spend",
      `/api/gateway/v1/end-users/${encodeURIComponent(endUserId)}/spend${qs}`,
    );
    return res.data;
  }
}
