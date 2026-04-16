import type { paths } from "@/internal/generated/openapi/api-client";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";

export type ModelProvidersListResponse =
  paths["/api/model-providers"]["get"]["responses"]["200"]["content"]["application/json"];

export type UpdateModelProviderBody = NonNullable<
  paths["/api/model-providers/{provider}"]["put"]["requestBody"]
>["content"]["application/json"];

export class ModelProvidersApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ModelProvidersApiError";
  }
}

export class ModelProvidersApiService {
  private readonly apiClient: LangwatchApiClient;

  constructor(config?: Pick<InternalConfig, "langwatchApiClient">) {
    this.apiClient = config?.langwatchApiClient ?? createLangWatchApiClient();
  }

  private handleApiError(operation: string, error: unknown): never {
    const message = formatApiErrorForOperation({ operation: operation, error: error, options: {
      status: extractStatusFromResponse(error),
    } });
    throw new ModelProvidersApiError(message, operation, error);
  }

  async list(): Promise<ModelProvidersListResponse> {
    const { data, error } = await this.apiClient.GET("/api/model-providers");
    if (error) this.handleApiError("list model providers", error);
    return data;
  }

  async set(provider: string, params: UpdateModelProviderBody): Promise<ModelProvidersListResponse> {
    const { data, error } = await this.apiClient.PUT(
      "/api/model-providers/{provider}",
      {
        params: { path: { provider } },
        body: params,
      },
    );
    if (error)
      this.handleApiError(`set model provider "${provider}"`, error);
    return data;
  }
}
