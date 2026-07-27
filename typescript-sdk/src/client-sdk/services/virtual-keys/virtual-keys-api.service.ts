import { scopedApiKey } from "@/internal/credentialContext";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export type VirtualKeyScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface VirtualKeyScope {
  scope_type: VirtualKeyScopeType;
  scope_id: string;
}

export type VirtualKeyRoutingMode = "NONE" | "FALLBACK_ALL" | "POLICY";

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
  status: "active" | "revoked";
  /** "langy" marks a product-managed key; customers can only mint "user". */
  purpose: "user" | "langy";
  /** e.g. "vk-lw-01HZX9" — the only secret material kept after creation. */
  display_prefix: string;
  principal_user_id: string | null;
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
  window: "DAY" | "WEEK" | "MONTH";
  timezone?: string | null;
  on_breach?: "BLOCK" | "WARN";
  name?: string;
}

export interface CreateVirtualKeyInput {
  name: string;
  description?: string;
  principal_user_id?: string | null;
  /** Defaults to the caller's project when omitted. */
  scopes?: VirtualKeyScope[];
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

/** Aggregate spend for one key over a window, from the cost path. */
export interface VirtualKeySpendSummary {
  virtual_key_id: string;
  spent_usd: string;
  requests: number;
  window: { from: string; to: string };
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

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = (config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
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

  async list(): Promise<VirtualKey[]> {
    const { data } = await this.request<{ data: VirtualKey[] }>(
      "list virtual keys",
      "/api/gateway/v1/virtual-keys",
    );
    return data;
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

  /**
   * Aggregate spend for one key. Defaults to the current UTC calendar
   * month server-side. Reads the same cost path the dashboard reads, so
   * this number and the UI agree by construction.
   */
  async spend(
    id: string,
    window?: { from?: string; to?: string },
  ): Promise<VirtualKeySpendSummary> {
    const params = new URLSearchParams();
    if (window?.from) params.set("from", window.from);
    if (window?.to) params.set("to", window.to);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<VirtualKeySpendSummary>(
      `read virtual key spend "${id}"`,
      `/api/gateway/v1/virtual-keys/${encodeURIComponent(id)}/spend${query}`,
    );
  }
}
