import { scopedApiKey, scopedProjectId } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

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
  private readonly configuredProjectId: string | undefined;

  constructor(config?: { apiKey?: string; endpoint?: string; projectId?: string }) {
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint = resolveEndpoint(config?.endpoint);
    this.configuredProjectId = config?.projectId;
  }

  private projectId(): string {
    const projectId =
      this.configuredProjectId ?? scopedProjectId() ?? process.env.LANGWATCH_PROJECT_ID;
    if (!projectId) {
      throw new SecretsApiError(
        "A projectId is required for secret operations",
        "configuration",
      );
    }
    return projectId;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        ...buildAuthHeaders({ apiKey: this.apiKey, projectId: this.projectId() }),
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
      const message = formatApiErrorMessage({
        error: parsed,
        options: { status: response.status },
      });
      throwIfHandledError({
        operation: options?.method ?? "GET",
        error: parsed,
        status: response.status,
        message: `HTTP ${response.status}: ${message}`,
      });
      throw new SecretsApiError(
        `HTTP ${response.status}: ${message}`,
        options?.method ?? "GET",
        parsed,
      );
    }

    return response.json() as Promise<T>;
  }

  async getAll(): Promise<SecretResponse[]> {
    return this.request<SecretResponse[]>("/api/secrets/latest/secrets.list", {
      method: "POST",
      body: JSON.stringify({ projectId: this.projectId() }),
    });
  }

  async get(id: string): Promise<SecretResponse> {
    return this.request<SecretResponse>("/api/secrets/latest/secrets.get", {
      method: "POST",
      body: JSON.stringify({ projectId: this.projectId(), id }),
    });
  }

  async create(body: { name: string; value: string }): Promise<SecretResponse> {
    return this.request<SecretResponse>("/api/secrets/latest/secrets.create", {
      method: "POST",
      body: JSON.stringify({ projectId: this.projectId(), ...body }),
    });
  }

  async update(id: string, body: { value: string }): Promise<SecretResponse> {
    return this.request<SecretResponse>("/api/secrets/latest/secrets.update", {
      method: "POST",
      body: JSON.stringify({ projectId: this.projectId(), id, ...body }),
    });
  }

  async delete(id: string): Promise<SecretDeleteResponse> {
    return this.request<SecretDeleteResponse>("/api/secrets/latest/secrets.delete", {
      method: "POST",
      body: JSON.stringify({ projectId: this.projectId(), id }),
    });
  }
}
