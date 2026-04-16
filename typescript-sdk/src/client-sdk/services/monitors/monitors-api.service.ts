import { DEFAULT_ENDPOINT } from "@/internal/constants";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export interface MonitorResponse {
  id: string;
  name: string;
  slug: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  sample: number;
  level: string;
  evaluatorId: string | null;
  preconditions: unknown[];
  parameters: Record<string, unknown>;
  mappings: Record<string, unknown>;
  threadIdleTimeout: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMonitorBody {
  name: string;
  checkType: string;
  executionMode?: string;
  sample?: number;
  level?: string;
  preconditions?: unknown[];
  parameters?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
}

export interface UpdateMonitorBody {
  name?: string;
  enabled?: boolean;
  executionMode?: string;
  sample?: number;
  preconditions?: unknown[];
  parameters?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
}

export interface MonitorDeleteResponse {
  id: string;
  deleted: boolean;
}

export class MonitorsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "MonitorsApiError";
  }
}

export class MonitorsApiService {
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
      const message = formatApiErrorMessage(parsed, { status: response.status });
      throw new MonitorsApiError(
        `HTTP ${response.status}: ${message}`,
        options?.method ?? "GET",
        parsed,
      );
    }

    return response.json() as Promise<T>;
  }

  async getAll(): Promise<MonitorResponse[]> {
    return this.request<MonitorResponse[]>("/api/monitors");
  }

  async get(id: string): Promise<MonitorResponse> {
    return this.request<MonitorResponse>(`/api/monitors/${encodeURIComponent(id)}`);
  }

  async create(body: CreateMonitorBody): Promise<MonitorResponse> {
    return this.request<MonitorResponse>("/api/monitors", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async update(id: string, body: UpdateMonitorBody): Promise<MonitorResponse> {
    return this.request<MonitorResponse>(`/api/monitors/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async toggle(id: string, enabled: boolean): Promise<MonitorResponse> {
    return this.request<MonitorResponse>(`/api/monitors/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  async delete(id: string): Promise<MonitorDeleteResponse> {
    return this.request<MonitorDeleteResponse>(`/api/monitors/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
}
