import { scopedApiKey } from "@/internal/credentialContext";
import {
  CURSOR_WALK_PAGE_SIZE,
  collectCursorPages,
  walkCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import {
  idempotentCreateInit,
  mutationInit,
  type IdempotentCreateOptions,
  type MutationOptions,
  type ObservedRequestInit,
} from "@/client-sdk/services/_shared/mutation-options";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { resolveEndpoint } from "@/internal/endpoint";

export type VirtualKeyScopeType = "organization" | "team" | "project";

export interface VirtualKeyScope {
  scope_type: VirtualKeyScopeType;
  scope_id: string;
}

export type VirtualKeyRoutingMode = "none" | "fallback_all" | "policy";

/**
 * The snake DTO the server returns (`toVirtualKeySnakeDto`). The token
 * format is `vk-lw-<ulid>` with no live/test discriminator; the gateway
 * never branches on environment, so there is no env field.
 */
export interface VirtualKey {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  /** `disabled` is the reversible stop; `revoked` is terminal. */
  status: "active" | "disabled" | "revoked";
  /** "langy" marks a product-managed key; customers can only mint "user". */
  purpose: "user" | "langy";
  /** e.g. "vk-lw-01HZX9" — the only secret material kept after creation. */
  display_prefix: string;
  principal_user_id: string | null;
  /**
   * Where an org- or team-owned key's traces and costs land. Not a
   * scope: it grants no access to the key.
   */
  trace_project_id: string | null;
  scopes: VirtualKeyScope[];
  routing_policy_id: string | null;
  routing_mode: VirtualKeyRoutingMode;
  config: Record<string, unknown>;
  revision: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * The cap a key carries on itself, created atomically with the key. Only
 * the calendar windows a person reasons about; string amounts survive
 * JSON round-trips without float drift (numbers are stringified).
 */
export interface VirtualKeyBudgetInput {
  limit_usd: string | number;
  window: "day" | "week" | "month";
  on_breach?: "block" | "warn";
  name?: string;
}

export interface CreateVirtualKeyInput {
  name: string;
  description?: string;
  principal_user_id?: string | null;
  /** Defaults to the caller's project when omitted. */
  scopes?: VirtualKeyScope[];
  /**
   * Explicit trace destination for org- and team-owned keys; requires
   * `virtualKeys:manage` on that project. NOT a scope.
   */
  trace_project_id?: string | null;
  routing_policy_id?: string | null;
  routing_mode?: VirtualKeyRoutingMode;
  /** Optional cap created atomically with the key. */
  budget?: VirtualKeyBudgetInput | null;
  config?: Record<string, unknown>;
  /**
   * Your own identifier for this key, unique within the organization. Lets
   * you look the key up by the id your system already has instead of storing
   * ours alongside it.
   */
  external_id?: string | null;
  /**
   * Free-form string labels, up to 40 of them. Sent WHOLE on an update: the
   * map you pass replaces the stored one rather than merging into it, and
   * `{}` clears it.
   */
  metadata?: Record<string, string>;
}

export interface UpdateVirtualKeyInput {
  name?: string;
  description?: string | null;
  scopes?: VirtualKeyScope[];
  trace_project_id?: string | null;
  routing_policy_id?: string | null;
  routing_mode?: VirtualKeyRoutingMode;
  /** Undefined leaves the cap alone; a value upserts it; null archives it. */
  budget?: VirtualKeyBudgetInput | null;
  config?: Record<string, unknown>;
  /**
   * Your own identifier for this key, unique within the organization. Lets
   * you look the key up by the id your system already has instead of storing
   * ours alongside it.
   */
  external_id?: string | null;
  /**
   * Free-form string labels, up to 40 of them. Sent WHOLE on an update: the
   * map you pass replaces the stored one rather than merging into it, and
   * `{}` clears it.
   */
  metadata?: Record<string, string>;
}

export interface VirtualKeyWithSecret {
  virtual_key: VirtualKey;
  secret: string;
}

/** One page of the virtual-key listing, exactly as the wire serves it. */
export interface VirtualKeyPage {
  data: VirtualKey[];
  /**
   * Pass back as `cursor` for the next page. Null means the walk is
   * exhausted. Neither page length tells you anything here: visibility is
   * applied to each page AFTER it is read, so a page can hold fewer rows
   * than `limit` with more still to come.
   */
  next_cursor: string | null;
}

/** Aggregate spend for one key over a window, from the cost path. */
export interface VirtualKeySpendSummary {
  virtual_key_id: string;
  spent_usd: string;
  requests: number;
  /** Epoch milliseconds, the unit every spend surface takes and returns. */
  window: { from: number; to: number };
}

export class VirtualKeysApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "VirtualKeysApiError";
  }
}

/**
 * Client for the gateway virtual-key surface (/api/gateway/v1).
 *
 * Entity types and the create/update bodies mirror the wire verbatim, so
 * their fields are lowercase snake_case. Call options this SDK invents (query
 * filters, per-call behaviour, action arguments) are camelCase like the rest
 * of the SDK.
 */
export class VirtualKeysApiService {
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

  private async request<T>(
    operation: string,
    path: string,
    init?: ObservedRequestInit,
  ): Promise<T> {
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
      throw new VirtualKeysApiError(message, operation, parsedBody);
    }
    init?.onResponse?.(response);
    return (await response.json()) as T;
  }

  /**
   * ONE page of the virtual keys visible to the caller, newest first. Pass
   * `next_cursor` back as `cursor` for the next page, verbatim: a cursor this
   * endpoint did not issue answers 400 rather than restarting the walk.
   *
   * `limit` is the page size (server default 50, capped at 200), and it caps
   * the rows READ, not the rows returned: the visibility filter runs on the
   * page afterwards. Prefer `list()` unless you mean to page deliberately.
   */
  async listPage(options?: {
    cursor?: string;
    limit?: number;
    /** Exact match on your own identifier, not a prefix or a search. */
    externalId?: string;
  }): Promise<VirtualKeyPage> {
    const params = new URLSearchParams();
    if (options?.externalId) params.set("external_id", options.externalId);
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString() !== "" ? `?${params.toString()}` : "";
    const { data, next_cursor } = await this.request<{
      data: VirtualKey[];
      next_cursor?: string | null;
    }>("list virtual keys", `/api/gateway/v1/virtual-keys${query}`);
    return { data, next_cursor: next_cursor ?? null };
  }

  /**
   * Every virtual key visible to the caller: keys scoped to this project, to
   * its team, or to the whole organization.
   *
   * The endpoint pages; this follows `next_cursor` until it comes back null.
   * Stopping on a short page would be wrong here specifically, because the
   * server filters each page for visibility after reading it, so a page can
   * hold fewer rows than the limit with more still to come.
   *
   * `limit` sizes each request in the walk, it does NOT cap what comes back.
   * `cursor` resumes an interrupted walk. Take a single page with
   * `listPage()`, or stream the walk with `iterate()`.
   */
  async list(options?: {
    cursor?: string;
    limit?: number;
    /** Exact match on your own identifier, not a prefix or a search. */
    externalId?: string;
  }): Promise<VirtualKey[]> {
    const pages = await collectCursorPages<VirtualKeyPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new VirtualKeysApiError(
          `Failed to list virtual keys: ${reason}.`,
          "list virtual keys",
        ),
      fetchPage: (cursor) =>
        this.listPage({
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
          externalId: options?.externalId,
        }),
    });
    return pages.flatMap((page) => page.data);
  }

  /**
   * Every visible virtual key, one row at a time, fetching each page only
   * when the consumer reaches it. Stop early and the rest is never read,
   * which `list()` cannot offer because it materialises the whole listing
   * first. Raises rather than looping forever on a cursor chain that never
   * ends, exactly like `list()`.
   */
  async *iterate(options?: {
    cursor?: string;
    limit?: number;
    /** Exact match on your own identifier, not a prefix or a search. */
    externalId?: string;
  }): AsyncGenerator<VirtualKey> {
    const pages = walkCursorPages<VirtualKeyPage>({
      startCursor: options?.cursor,
      nextCursorOf: (page) => page.next_cursor,
      onEndlessWalk: (reason) =>
        new VirtualKeysApiError(
          `Failed to list virtual keys: ${reason}.`,
          "list virtual keys",
        ),
      fetchPage: (cursor) =>
        this.listPage({
          cursor,
          limit: options?.limit ?? CURSOR_WALK_PAGE_SIZE,
          externalId: options?.externalId,
        }),
    });
    for await (const page of pages) {
      yield* page.data;
    }
  }

  async get(id: string): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `get virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}`,
    );
    return virtual_key;
  }

  /**
   * Mint a key. The response carries the secret ONCE; nothing ever serves it
   * again, so a create that times out is recovered with `idempotencyKey`
   * rather than by listing.
   */
  async create(
    input: CreateVirtualKeyInput,
    options?: IdempotentCreateOptions,
  ): Promise<VirtualKeyWithSecret> {
    return this.request<VirtualKeyWithSecret>(
      "create virtual key",
      "/api/gateway/v1/virtual-keys",
      {
        method: "POST",
        body: JSON.stringify(input),
        ...idempotentCreateInit(options),
      },
    );
  }

  async update(
    id: string,
    input: UpdateVirtualKeyInput,
    options?: MutationOptions,
  ): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `update virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input), ...mutationInit(options) },
    );
    return virtual_key;
  }

  async rotate(
    id: string,
    options?: MutationOptions,
  ): Promise<VirtualKeyWithSecret> {
    return this.request<VirtualKeyWithSecret>(
      `rotate virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/rotate`,
      { method: "POST", ...mutationInit(options) },
    );
  }

  async revoke(id: string, options?: MutationOptions): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `revoke virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/revoke`,
      { method: "POST", ...mutationInit(options) },
    );
    return virtual_key;
  }

  /** Reversible stop; enable() restores the key exactly as it was. */
  async disable(
    id: string,
    options: { reason?: string } & MutationOptions = {},
  ): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `disable virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/disable`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
        ...mutationInit(options),
      },
    );
    return virtual_key;
  }

  async enable(id: string, options?: MutationOptions): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `enable virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/enable`,
      { method: "POST", ...mutationInit(options) },
    );
    return virtual_key;
  }

  /**
   * Aggregate spend for one key over a window in epoch milliseconds.
   * Defaults to the current UTC calendar month server-side. Reads the same
   * cost path the dashboard reads, so this number and the UI agree by
   * construction.
   */
  async spend(
    id: string,
    options?: { from?: number; to?: number },
  ): Promise<VirtualKeySpendSummary> {
    const params = new URLSearchParams();
    if (options?.from !== undefined) params.set("from", String(options.from));
    if (options?.to !== undefined) params.set("to", String(options.to));
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<VirtualKeySpendSummary>(
      `read virtual key spend "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/spend${query}`,
    );
  }
}
