import { scopedApiKey } from "@/internal/credentialContext";
import {
  CURSOR_WALK_PAGE_SIZE,
  collectCursorPages,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { resolveEndpoint } from "@/internal/endpoint";

export type BudgetScopeKind =
  | "organization"
  | "team"
  | "project"
  | "virtual_key"
  | "principal"
  | "group"
  | "attributed_user";

export type BudgetWindow = "minute" | "hour" | "day" | "week" | "month" | "total" | "manual";
export type BudgetOnBreach = "block" | "warn";

export interface GatewayBudget {
  id: string;
  organization_id: string;
  scope_type: BudgetScopeKind;
  scope_id: string;
  name: string;
  description: string | null;
  window: BudgetWindow;
  on_breach: BudgetOnBreach;
  /**
   * For `group` rows this is the PER-MEMBER allowance, not a group total;
   * `spent_usd` sums the whole group and `member_count` says how many
   * members the allowance currently covers. For `attributed_user` rows it is
   * the PER-PERSON cap, and `end_users_seen` / `end_users_over` carry the
   * standing instead of `spent_usd`.
   */
  limit_usd: string;
  /** Canonical integer limit, nano-USD. Null past the safe integer range. */
  limit_nano_usd: number | null;
  /**
   * Display value. NULL when `spend_available` is false: spend could not be
   * totalled, so there is no figure, and the API sends null rather than a
   * stale one a caller could mistake for real money.
   */
  spent_usd: string | null;
  /** Canonical integer spend, nano-USD. Null whenever `spent_usd` is. */
  spent_nano_usd: number | null;
  timezone: string | null;
  /** ModelProvider id the budget counts; null counts every provider. */
  provider_key: string | null;
  current_period_started_at: string;
  resets_at: string;
  /** Instant the cycle is phased from; null means calendar aligned. */
  cycle_anchor_at: string | null;
  last_reset_at: string | null;
  archived_at: string | null;
  created_at: string;
  /** `group` rows only. */
  member_count?: number;
  /** `attributed_user` rows only: end users with spend this period. */
  end_users_seen?: number;
  /** `attributed_user` rows only: how many of those are at or over the cap. */
  end_users_over?: number;
}

/**
 * One page of the budget listing, exactly as the wire serves it.
 *
 * Budgets come back in an envelope where virtual keys come back as a bare
 * array because `spend_available` is a correctness flag about the whole page,
 * and an array cannot carry it.
 */
export interface GatewayBudgetPage {
  data: GatewayBudget[];
  /**
   * False when spend could not be totalled: render "unavailable" rather
   * than trusting `spent_usd` as real spend.
   */
  spend_available: boolean;
  /**
   * Pass back as `cursor` for the next page. Null means the walk is
   * exhausted; a FULL page does not by itself mean there is more.
   */
  next_cursor: string | null;
}

/** The complete budget listing, after a walk to exhaustion. */
export interface GatewayBudgetListing {
  data: GatewayBudget[];
  /**
   * False when ANY page of the walk could not total spend: one unreadable
   * page makes the whole listing's spend unreal.
   */
  spend_available: boolean;
}

export type CreateGatewayBudgetScope =
  | { kind: "organization"; organization_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "project"; project_id: string }
  | { kind: "virtual_key"; virtual_key_id: string }
  | { kind: "principal"; principal_user_id: string }
  | { kind: "group"; group_id: string }
  // Template: each distinct external end user on the anchor gets the
  // budget's limit per window. Exactly one anchor id.
  | {
      kind: "attributed_user";
      anchor_virtual_key_id?: string;
      anchor_project_id?: string;
    };

export interface CreateGatewayBudgetInput {
  scope: CreateGatewayBudgetScope;
  name: string;
  description?: string;
  window: BudgetWindow;
  limit_usd: number | string;
  on_breach?: BudgetOnBreach;
  timezone?: string | null;
  /** ModelProvider id to pin the budget to one provider. */
  provider_key?: string | null;
  /**
   * RFC3339 instant that phases the budget's cycle instead of the calendar:
   * a `month` budget anchored `2026-01-17T09:00:00Z` rolls every 17th at
   * 09:00 UTC. Omit for calendar alignment. Immutable once created, and
   * rejected on the windows that never cycle (`total`, `manual`).
   */
  cycle_anchor_at?: string;
}

export interface UpdateGatewayBudgetInput {
  name?: string;
  description?: string | null;
  limit_usd?: number | string;
  on_breach?: BudgetOnBreach;
  timezone?: string | null;
}

export class GatewayBudgetsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GatewayBudgetsApiError";
  }
}

/**
 * Client for the gateway budget surface (/api/gateway/v1).
 *
 * Entity types and the create/update bodies mirror the wire verbatim, so
 * their fields are lowercase snake_case. Call options this SDK invents (query
 * filters, per-call behaviour, action arguments) are camelCase like the rest
 * of the SDK.
 */
export class GatewayBudgetsApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectId: string | undefined;

  constructor(config?: { endpoint?: string; apiKey?: string; projectId?: string }) {
    this.endpoint = resolveEndpoint(config?.endpoint);
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    this.projectId = config?.projectId ?? process.env.LANGWATCH_PROJECT_ID;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      // Org-anchored API keys carry no project of their own; the surface
      // scopes on this header. Absent for project keys, which self-scope.
      ...(this.projectId ? { "X-Project-Id": this.projectId } : {}),
    };
  }

  private async request<T>(operation: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      // A hung control plane must fail the command, not freeze it.
      signal: init?.signal ?? AbortSignal.timeout(30_000),
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
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
      throw new GatewayBudgetsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  /**
   * ONE page of non-archived budgets, exactly as the wire serves it. Pass
   * `next_cursor` back as `cursor` for the next page, verbatim: a cursor this
   * endpoint did not issue answers 400 rather than restarting the walk.
   *
   * `limit` is the page size (server default 50, capped at 200). Prefer
   * `list()` unless you mean to page deliberately: a full page is not a
   * promise of more, and a null `next_cursor` is the only end of the walk.
   */
  async listPage(options?: {
    scopeTypes?: BudgetScopeKind[];
    cursor?: string;
    limit?: number;
  }): Promise<GatewayBudgetPage> {
    const params = new URLSearchParams();
    if (options?.scopeTypes?.length) {
      params.set("scope_type", options.scopeTypes.join(","));
    }
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString() !== "" ? `?${params.toString()}` : "";
    const { data, spend_available, next_cursor } = await this.request<{
      data: GatewayBudget[];
      spend_available: boolean;
      next_cursor?: string | null;
    }>("list gateway budgets", `/api/gateway/v1/budgets${query}`);
    return {
      data,
      spend_available,
      next_cursor: next_cursor ?? null,
    };
  }

  /**
   * Every non-archived budget in the organization across all seven scope
   * types, optionally filtered by `scopeTypes`.
   *
   * The endpoint pages; this follows `next_cursor` until it comes back null,
   * so the result is the complete listing and carries no cursor of its own.
   * Callers that count, total, or decide an all-clear on this list need that
   * completeness for correctness, not just for display.
   *
   * `limit` sizes each request in the walk, it does NOT cap what comes back.
   * `cursor` resumes an interrupted walk. Take a single page with
   * `listPage()`, or stream the walk with `iterate()`.
   */
  async list(options?: {
    scopeTypes?: BudgetScopeKind[];
    cursor?: string;
    limit?: number;
  }): Promise<GatewayBudgetListing> {
    const pages = await collectCursorPages<GatewayBudgetPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new GatewayBudgetsApiError(
          `Failed to list gateway budgets: ${reason}.`,
          "list gateway budgets",
        ),
      fetchPage: (cursor) =>
        this.listPage({
          scopeTypes: options?.scopeTypes,
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    return {
      data: pages.flatMap((page) => page.data),
      // One page that could not total spend makes the whole listing's spend
      // unreal, so the set's honest answer is the pessimistic one.
      spend_available: pages.every((page) => page.spend_available),
    };
  }

  /**
   * Every non-archived budget, one row at a time, fetching each page only
   * when the consumer reaches it.
   *
   * The rows come without the listing's `spend_available` flag, which is a
   * property of the pages rather than of any single budget. Use `list()`
   * when the answer depends on whether spend could be totalled at all.
   */
  async *iterate(options?: {
    scopeTypes?: BudgetScopeKind[];
    cursor?: string;
    limit?: number;
  }): AsyncGenerator<GatewayBudget> {
    const pages = walkCursorPages<GatewayBudgetPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new GatewayBudgetsApiError(
          `Failed to list gateway budgets: ${reason}.`,
          "list gateway budgets",
        ),
      fetchPage: (cursor) =>
        this.listPage({
          scopeTypes: options?.scopeTypes,
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
  }

  async create(input: CreateGatewayBudgetInput): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      "create gateway budget",
      "/api/gateway/v1/budgets",
      { method: "POST", body: JSON.stringify(input) },
    );
    return budget;
  }

  async update(id: string, input: UpdateGatewayBudgetInput): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `update gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return budget;
  }

  async archive(id: string): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `archive gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return budget;
  }

  /**
   * Move the budget's period boundary to now. Recorded spend is never
   * mutated; with `endUserId` only that end-user bucket's boundary moves.
   */
  async reset(
    id: string,
    options: { endUserId?: string; reason?: string } = {},
  ): Promise<GatewayBudget> {
    const query = options.endUserId
      ? `?end_user_id=${encodeURIComponent(options.endUserId)}`
      : "";
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `reset gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}/reset${query}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
      },
    );
    return budget;
  }
}
