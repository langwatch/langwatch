import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export interface SecretResponse {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretDeleteResponse {
  id: string;
  deleted: boolean;
}

export class SecretsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "SecretsApiError";
  }
}

export class SecretsApiService {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config?: { apiKey?: string; endpoint?: string }) {
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint = config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        "X-Auth-Token": this.apiKey,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown = errorText;
      try {
        parsed = JSON.parse(errorText);
      } catch {
        // leave as raw text
      }
      const message = formatApiErrorMessage({ error: parsed, options: { status: response.status } });
      throw new SecretsApiError(
        `HTTP ${response.status}: ${message}`,
        options?.method ?? "GET",
        parsed,
      );
    }

    return response.json() as Promise<T>;
  }

  async getAll(): Promise<SecretResponse[]> {
    return this.request<SecretResponse[]>("/api/secrets");
  }

  async get(id: string): Promise<SecretResponse> {
    return this.request<SecretResponse>(`/api/secrets/${encodeURIComponent(id)}`);
  }

  async create(body: { name: string; value: string }): Promise<SecretResponse> {
    return this.request<SecretResponse>("/api/secrets", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async update(id: string, body: { value: string }): Promise<SecretResponse> {
    return this.request<SecretResponse>(`/api/secrets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async delete(id: string): Promise<SecretDeleteResponse> {
    return this.request<SecretDeleteResponse>(`/api/secrets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
}
