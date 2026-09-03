import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import type { paths } from "@/internal/generated/openapi/api-client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

/** One run parameter an agent declares, as the platform lists it. */
export interface AgentParameterSpec {
  name: string;
  type: "string" | "number" | "boolean";
  options?: string[];
  default?: string | number | boolean;
  description?: string;
  required?: boolean;
  secret?: boolean;
}

/** One process connected as an instance of a connected agent. */
export interface AgentInstance {
  id: string;
  hostname: string;
  label?: string | null;
  connectedAt: string;
}

export interface AgentResponse {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  platformUrl?: string;
  /** Connected agents: the environment the SDK registered under. */
  environment?: string | null;
  /** Connected agents: online while at least one instance is connected. */
  status?: "online" | "offline" | null;
  instances?: AgentInstance[];
  lastSeenAt?: string | null;
  /** The owner of a personal agent. */
  owner?: { userId: string; name: string } | null;
  /** The machine a host-scoped development agent belongs to. */
  hostLabel?: string | null;
  parameters?: AgentParameterSpec[];
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

/** The body `POST /api/v1/agents/{id}/call` takes. */
export type AgentCallBody = NonNullable<
  paths["/api/v1/agents/{id}/call"]["post"]["requestBody"]
>["content"]["application/json"];

/** One conversation message as the relay carries it, OpenAI style. */
export type AgentCallMessage = AgentCallBody["messages"][number];

/** The reply of the relay: the function's output and the instance that ran it. */
export type AgentCallResponse =
  paths["/api/v1/agents/{id}/call"]["post"]["responses"][200]["content"]["application/json"];

/** The ids `POST /api/v1/agents/{id}/test` answers with. */
export type AgentTestRunResponse =
  paths["/api/v1/agents/{id}/test"]["post"]["responses"][200]["content"]["application/json"];

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
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: extractStatusFromResponse(error),
      },
    });
    throw new AgentsApiError(message, operation, error);
  }

  async list(params?: { page?: number; limit?: number }): Promise<AgentListResponse> {
    const { data, error } = await this.apiClient.GET("/api/v1/agents", {
      params: { query: params },
    });
    if (error) this.handleApiError("list agents", error);
    return data as unknown as AgentListResponse;
  }

  async get(id: string): Promise<AgentResponse> {
    const { data, error } = await this.apiClient.GET("/api/v1/agents/{id}", {
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
    const { data, error } = await this.apiClient.POST("/api/v1/agents", {
      body: params as never,
    });
    if (error) this.handleApiError("create agent", error);
    return data as unknown as AgentResponse;
  }

  async update(
    id: string,
    params: {
      name?: string;
      type?: string;
      config?: Record<string, unknown>;
    },
  ): Promise<AgentResponse> {
    const { data, error } = await this.apiClient.PATCH("/api/v1/agents/{id}", {
      params: { path: { id } },
      body: params as never,
    });
    if (error) this.handleApiError(`update agent "${id}"`, error);
    return data as unknown as AgentResponse;
  }

  async delete(id: string): Promise<{ id: string; name: string }> {
    const { data, error } = await this.apiClient.DELETE("/api/v1/agents/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete agent "${id}"`, error);
    return data as unknown as { id: string; name: string };
  }

  /**
   * Runs one turn of a connected agent through the relay: the platform
   * dispatches it to a live instance and answers with the function's output.
   */
  async call(id: string, body: AgentCallBody): Promise<AgentCallResponse> {
    const { data, error } = await this.apiClient.POST("/api/v1/agents/{id}/call", {
      params: { path: { id } },
      body,
    });
    if (error) this.handleApiError(`call agent "${id}"`, error);
    return data as AgentCallResponse;
  }

  /**
   * Runs one scripted scenario against an agent: the user sends "ping", the
   * agent answers, and the run succeeds when the answer arrives. The project
   * gains no scenario, run plan or test suite, and the answer carries the run
   * ids to follow.
   */
  async test(id: string): Promise<AgentTestRunResponse> {
    const { data, error } = await this.apiClient.POST("/api/v1/agents/{id}/test", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`test agent "${id}"`, error);
    return data as AgentTestRunResponse;
  }
}
