import { scopedApiKey } from "@/internal/credentialContext";
import {
  CURSOR_WALK_PAGE_SIZE,
  collectCursorPages,
} from "@/client-sdk/services/_shared/collect-cursor-pages";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

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

export class VirtualKeysApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectId: string | undefined;

  constructor(config?: { endpoint?: string; apiKey?: string; projectId?: string }) {
    this.endpoint = (config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
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
  }): Promise<VirtualKeyPage> {
    const params = new URLSearchParams();
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
   * `listPage()`.
   */
  async list(options?: {
    cursor?: string;
    limit?: number;
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
        }),
    });
    return pages.flatMap((page) => page.data);
  }

  async get(id: string): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `get virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}`,
    );
    return virtual_key;
  }

  async create(input: CreateVirtualKeyInput): Promise<VirtualKeyWithSecret> {
    return this.request<VirtualKeyWithSecret>(
      "create virtual key",
      "/api/gateway/v1/virtual-keys",
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  async update(id: string, input: UpdateVirtualKeyInput): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `update virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return virtual_key;
  }

  async rotate(id: string): Promise<VirtualKeyWithSecret> {
    return this.request<VirtualKeyWithSecret>(
      `rotate virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/rotate`,
      { method: "POST" },
    );
  }

  async revoke(id: string): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `revoke virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    );
    return virtual_key;
  }

  /** Reversible stop; enable() restores the key exactly as it was. */
  async disable(id: string, options: { reason?: string } = {}): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `disable virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/disable`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
      },
    );
    return virtual_key;
  }

  async enable(id: string): Promise<VirtualKey> {
    const { virtual_key } = await this.request<{ virtual_key: VirtualKey }>(
      `enable virtual key "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/enable`,
      { method: "POST" },
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
    window?: { from?: number; to?: number },
  ): Promise<VirtualKeySpendSummary> {
    const params = new URLSearchParams();
    if (window?.from !== undefined) params.set("from", String(window.from));
    if (window?.to !== undefined) params.set("to", String(window.to));
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<VirtualKeySpendSummary>(
      `read virtual key spend "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/spend${query}`,
    );
  }
}
