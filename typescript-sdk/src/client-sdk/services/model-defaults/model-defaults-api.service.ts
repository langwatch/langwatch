import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { buildAuthHeaders } from "@/internal/api/auth";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export type ModelDefaultScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface ModelDefaultScopeRef {
  scopeType: ModelDefaultScopeType;
  scopeId: string;
}

export interface ConfigRow {
  id: string;
  config: Record<string, string>;
  scopes: Array<{ type: ModelDefaultScopeType; id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveResolution {
  model: string;
  source: string;
  scope: string | null;
}

export interface ModelDefaultsSnapshot {
  scope: {
    projectId: string;
    teamId: string | null;
    organizationId: string | null;
    organizationName: string | null;
  };
  effective: {
    DEFAULT: EffectiveResolution | null;
    FAST: EffectiveResolution | null;
    EMBEDDINGS: EffectiveResolution | null;
  };
  configs: ConfigRow[];
}

export interface CreateConfigBody {
  config: Record<string, string>;
  scopes: ModelDefaultScopeRef[];
}

export interface UpdateConfigBody {
  config?: Record<string, string>;
  scopes?: ModelDefaultScopeRef[];
}

export class ModelDefaultsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ModelDefaultsApiError";
  }
}

export class ModelDefaultsApiService {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config?: { apiKey?: string; endpoint?: string }) {
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint =
      config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;
  }

  private async request<T>(
    path: string,
    options?: RequestInit & { allowNoContent?: boolean },
  ): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        ...buildAuthHeaders({ apiKey: this.apiKey }),
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
      throw new ModelDefaultsApiError(
        `HTTP ${response.status}: ${message}`,
        options?.method ?? "GET",
        parsed,
      );
    }

    if (response.status === 204 || options?.allowNoContent) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  async getSnapshot(): Promise<ModelDefaultsSnapshot> {
    return this.request<ModelDefaultsSnapshot>("/api/model-defaults");
  }

  async createConfig(body: CreateConfigBody): Promise<{ id: string }> {
    return this.request<{ id: string }>("/api/model-defaults", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateConfig(id: string, body: UpdateConfigBody): Promise<void> {
    await this.request<void>(
      `/api/model-defaults/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        allowNoContent: true,
      },
    );
  }

  async deleteConfig(id: string): Promise<void> {
    await this.request<void>(
      `/api/model-defaults/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        allowNoContent: true,
      },
    );
  }
}
