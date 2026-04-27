import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export type ProviderRotationPolicy = "auto" | "manual" | "external_secret_store";
export type ProviderHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface GatewayProviderCredential {
  id: string;
  model_provider_id: string;
  model_provider_name: string;
  slot: string | null;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  rate_limit_rpd: number | null;
  rotation_policy: ProviderRotationPolicy;
  fallback_priority_global: number | null;
  health_status: ProviderHealthStatus;
  disabled_at: string | null;
  created_at: string;
}

export interface CreateGatewayProviderInput {
  model_provider_id: string;
  slot?: string;
  rate_limit_rpm?: number | null;
  rate_limit_tpm?: number | null;
  rate_limit_rpd?: number | null;
  rotation_policy?: ProviderRotationPolicy;
  extra_headers?: Record<string, string> | null;
  provider_config?: Record<string, unknown> | null;
  fallback_priority_global?: number | null;
}

export interface UpdateGatewayProviderInput {
  slot?: string;
  rate_limit_rpm?: number | null;
  rate_limit_tpm?: number | null;
  rate_limit_rpd?: number | null;
  rotation_policy?: ProviderRotationPolicy;
  extra_headers?: Record<string, string> | null;
  provider_config?: Record<string, unknown> | null;
  fallback_priority_global?: number | null;
}

export class GatewayProvidersApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GatewayProvidersApiError";
  }
}

export class GatewayProvidersApiService {
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
      throw new GatewayProvidersApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(): Promise<GatewayProviderCredential[]> {
    const { data } = await this.request<{ data: GatewayProviderCredential[] }>(
      "list gateway providers",
      "/api/gateway/v1/providers",
    );
    return data;
  }

  async create(input: CreateGatewayProviderInput): Promise<{ id: string }> {
    const { provider_credential } = await this.request<{ provider_credential: { id: string } }>(
      "create gateway provider binding",
      "/api/gateway/v1/providers",
      { method: "POST", body: JSON.stringify(input) },
    );
    return provider_credential;
  }

  async update(id: string, input: UpdateGatewayProviderInput): Promise<{ id: string }> {
    const { provider_credential } = await this.request<{ provider_credential: { id: string } }>(
      `update gateway provider "${id}"`,
      `/api/gateway/v1/providers/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return provider_credential;
  }

  async disable(id: string): Promise<{ id: string; disabled_at: string | null }> {
    const { provider_credential } = await this.request<{
      provider_credential: { id: string; disabled_at: string | null };
    }>(
      `disable gateway provider "${id}"`,
      `/api/gateway/v1/providers/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return provider_credential;
  }
}
