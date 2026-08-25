import { scopedApiKey } from "@/internal/credentialContext";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import type {
  ManagementRole,
  ManagementScopeType,
} from "@/client-sdk/services/_shared/management-types";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { resolveEndpoint } from "@/internal/endpoint";

export interface RoleBinding {
  id: string;
  role: ManagementRole;
  scopeType: ManagementScopeType;
  scopeId: string;
}

/** What a key may do, and where, in the shape a write accepts. */
export interface ApiKeyBindingInput {
  role: ManagementRole;
  scopeType: ManagementScopeType;
  scopeId: string;
}

/**
 * How the key's bindings are read. `all` and `readonly` take their meaning
 * from the bindings alone; `restricted` additionally requires an explicit
 * permissions list, which is what a CUSTOM binding grants.
 */
export const API_KEY_PERMISSION_MODES = ["all", "readonly", "restricted"] as const;

export type ApiKeyPermissionMode = (typeof API_KEY_PERMISSION_MODES)[number];

export interface ApiKeyInfo {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  roleBindings: RoleBinding[];
}

/**
 * One key as GET /:id and PATCH /:id report it. `roleBindings` is the shape
 * the listing publishes; `bindings` is the same set in the shape a write
 * accepts, so reading a key back after a write is a comparison rather than a
 * translation.
 */
export interface ApiKeyDetail extends ApiKeyInfo {
  keyType: "personal" | "service";
  assignedToUserId: string | null;
  createdByUserId: string | null;
  permissionMode: ApiKeyPermissionMode;
  permissions: string[];
  bindings: ApiKeyBindingInput[];
}

export interface CreateApiKeyInput {
  keyType?: "personal" | "service";
  name: string;
  description?: string;
  expiresAt?: string;
  /** Organization admins only: the member the key acts as, and is capped by. */
  assignedToUserId?: string;
  permissionMode?: ApiKeyPermissionMode;
  /** Restricted mode only: the exact permissions the CUSTOM bindings grant. */
  permissions?: string[];
  bindings?: ApiKeyBindingInput[];
  projectIds?: string[];
}

/** Partial. A bindings list replaces the key's bindings outright. */
export interface UpdateApiKeyInput {
  name?: string;
  description?: string | null;
  permissionMode?: ApiKeyPermissionMode;
  permissions?: string[];
  bindings?: ApiKeyBindingInput[];
}

export interface CreatedApiKey {
  token: string;
  apiKey: {
    id: string;
    name: string;
    createdAt: string;
  };
}

export class ApiKeysApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ApiKeysApiError";
  }
}

export class ApiKeysApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = resolveEndpoint(config?.endpoint);
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    operation: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
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
      throw new ApiKeysApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(): Promise<ApiKeyInfo[]> {
    const { data } = await this.request<{ data: ApiKeyInfo[] }>(
      "list API keys",
      "/api/api-keys",
    );
    return data;
  }

  async get(id: string): Promise<ApiKeyDetail> {
    return this.request<ApiKeyDetail>(
      `fetch API key "${id}"`,
      `/api/api-keys/${encodeURIComponent(id)}`,
    );
  }

  async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    return this.request<CreatedApiKey>("create API key", "/api/api-keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async update({
    id,
    input,
  }: {
    id: string;
    input: UpdateApiKeyInput;
  }): Promise<ApiKeyDetail> {
    return this.request<ApiKeyDetail>(
      `update API key "${id}"`,
      `/api/api-keys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  }

  async revoke(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `revoke API key "${id}"`,
      `/api/api-keys/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }
}
