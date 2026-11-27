import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { mergeHeaders } from "@/client-sdk/services/_shared/merge-headers";
import { projectInScope } from "@/client-sdk/services/_shared/project-in-scope";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { buildRequestHeaders } from "@/internal/api/request-headers";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

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

  private async projectId(): Promise<string> {
    const projectId = await projectInScope({
      configuredProjectId: this.configuredProjectId,
      apiKey: this.apiKey,
      endpoint: this.endpoint,
    });
    if (!projectId) {
      throw new SecretsApiError("A projectId is required for secret operations", "configuration");
    }
    return projectId;
  }

  /** One operation's request; the caller resolves `projectId` once for URL, body and header. */
  private async request<T>({
    projectId,
    path,
    options,
  }: {
    projectId: string;
    path: string;
    options?: RequestInit;
  }): Promise<T> {
    const response = await langwatchFetch(`${this.endpoint}${path}`, {
      ...options,
      headers: mergeHeaders(
        {
          ...buildRequestHeaders({ apiKey: this.apiKey, projectId }),
          "Content-Type": "application/json",
        },
        options?.headers,
      ),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown = errorText;
      try {
        parsed = JSON.parse(errorText);
      } catch {
        // leave as raw text
        void 0;
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
    const projectId = await this.projectId();
    return this.request<SecretResponse[]>({
      projectId,
      path: `/api/v1/secrets?projectId=${encodeURIComponent(projectId)}`,
    });
  }

  async get(id: string): Promise<SecretResponse> {
    const projectId = await this.projectId();
    return this.request<SecretResponse>({
      projectId,
      path: `/api/v1/secrets/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
    });
  }

  async create(body: { name: string; value: string }): Promise<SecretResponse> {
    const projectId = await this.projectId();
    return this.request<SecretResponse>({
      projectId,
      path: "/api/v1/secrets",
      options: { method: "POST", body: JSON.stringify({ projectId, ...body }) },
    });
  }

  async update(id: string, body: { value: string }): Promise<SecretResponse> {
    const projectId = await this.projectId();
    return this.request<SecretResponse>({
      projectId,
      path: `/api/v1/secrets/${encodeURIComponent(id)}`,
      options: { method: "PUT", body: JSON.stringify({ projectId, ...body }) },
    });
  }

  async delete(id: string): Promise<SecretDeleteResponse> {
    const projectId = await this.projectId();
    return this.request<SecretDeleteResponse>({
      projectId,
      path: `/api/v1/secrets/${encodeURIComponent(id)}`,
      options: { method: "DELETE", body: JSON.stringify({ projectId }) },
    });
  }
}
