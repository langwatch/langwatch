import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export interface AgentResponse {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
}

export interface AgentListResponse {
  data: AgentResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class AgentsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "AgentsApiError";
  }
}

export class AgentsApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation(operation, error, {
      status: extractStatusFromResponse(error),
    });
    throw new AgentsApiError(message, operation, error);
  }

  async list(params?: { page?: number; limit?: number }): Promise<AgentListResponse> {
    const { data, error } = await this.apiClient.GET("/api/agents", {
      params: { query: params },
    });
    if (error) this.handleApiError("list agents", error);
    return data as unknown as AgentListResponse;
  }

  async get(id: string): Promise<AgentResponse> {
    const { data, error } = await this.apiClient.GET("/api/agents/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get agent "${id}"`, error);
    return data as unknown as AgentResponse;
  }

  async create(params: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    workflowId?: string;
  }): Promise<AgentResponse> {
    const { data, error } = await this.apiClient.POST("/api/agents", {
      body: params as never,
    });
    if (error) this.handleApiError("create agent", error);
    return data as unknown as AgentResponse;
  }

  async update(id: string, params: {
    name?: string;
    type?: string;
    config?: Record<string, unknown>;
  }): Promise<AgentResponse> {
    const { data, error } = await this.apiClient.PATCH("/api/agents/{id}", {
      params: { path: { id } },
      body: params as never,
    });
    if (error) this.handleApiError(`update agent "${id}"`, error);
    return data as unknown as AgentResponse;
  }

  async delete(id: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.apiClient.DELETE("/api/agents/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete agent "${id}"`, error);
    return data as unknown as { id: string; name: string };
  }
}
