import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import type { InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export type TriggerResponse = NonNullable<
  paths["/api/triggers"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type CreateTriggerBody = NonNullable<
  paths["/api/triggers"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateTriggerBody = NonNullable<
  paths["/api/triggers/{id}"]["patch"]["requestBody"]
>["content"]["application/json"];

export type TriggerDeleteResponse =
  paths["/api/triggers/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];

export class TriggersApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "TriggersApiError";
  }
}

export class TriggersApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
    throw new TriggersApiError(message, operation, error);
  }

  async getAll(): Promise<TriggerResponse[]> {
    const { data, error } = await this.apiClient.GET("/api/triggers");
    if (error) this.handleApiError("list triggers", error);
    return data;
  }

  async get(id: string): Promise<TriggerResponse> {
    const { data, error } = await this.apiClient.GET("/api/triggers/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`get trigger "${id}"`, error);
    return data;
  }

  async create(params: CreateTriggerBody): Promise<TriggerResponse> {
    const { data, error } = await this.apiClient.POST("/api/triggers", {
      body: params,
    });
    if (error) this.handleApiError("create trigger", error);
    return data;
  }

  async update(id: string, params: UpdateTriggerBody): Promise<TriggerResponse> {
    const { data, error } = await this.apiClient.PATCH("/api/triggers/{id}", {
      params: { path: { id } },
      body: params,
    });
    if (error) this.handleApiError(`update trigger "${id}"`, error);
    return data;
  }

  async delete(id: string): Promise<TriggerDeleteResponse> {
    const { data, error } = await this.apiClient.DELETE("/api/triggers/{id}", {
      params: { path: { id } },
    });
    if (error) this.handleApiError(`delete trigger "${id}"`, error);
    return data;
  }
}
