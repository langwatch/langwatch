import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface VirtualKey {
  id: string;
  name: string;
  description: string | null;
  environment: "live" | "test";
  prefix: string;
  last_four: string;
  status: "ACTIVE" | "REVOKED";
  principal_user_id: string | null;
  project_id: string;
  organization_id: string;
  provider_credential_ids: string[];
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface CreateVirtualKeyInput {
  name: string;
  description?: string;
  environment?: "live" | "test";
  principal_user_id?: string | null;
  provider_credential_ids: string[];
  config?: Record<string, unknown>;
}

export interface UpdateVirtualKeyInput {
  name?: string;
  description?: string | null;
  provider_credential_ids?: string[];
  config?: Record<string, unknown>;
}

export interface VirtualKeyWithSecret {
  virtual_key: VirtualKey;
  secret: string;
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
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
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
}
