import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface RoleBinding {
  id: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}

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

export interface CreateApiKeyInput {
  keyType?: "personal" | "service";
  name: string;
  description?: string;
  expiresAt?: string;
  bindings?: Array<{
    role: "ADMIN" | "MEMBER" | "VIEWER";
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  projectIds?: string[];
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

  async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    return this.request<CreatedApiKey>(
      "create API key",
      "/api/api-keys",
      { method: "POST", body: JSON.stringify(input) },
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
