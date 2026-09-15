import type { paths } from "@/internal/generated/openapi/api-client";
import { createLangWatchApiClient, type LangwatchApiClient } from "@/internal/api/client";
import { type InternalConfig } from "@/client-sdk/types";
import {
  extractStatusFromResponse,
  formatApiErrorForOperation,
} from "@/client-sdk/services/_shared/format-api-error";
import { unwrapApiResult } from "@/client-sdk/services/_shared/unwrap-api-result";

export type ModelProvidersListResponse =
  paths["/api/v1/model-providers"]["get"]["responses"]["200"]["content"]["application/json"];

export type UpdateModelProviderBody = NonNullable<
  paths["/api/v1/model-providers/{provider}"]["put"]["requestBody"]
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

  private handleApiError(operation: string, error: unknown, response?: Response): never {
    const message = formatApiErrorForOperation({
      operation: operation,
      error: error,
      options: {
        status: response?.status ?? extractStatusFromResponse(error),
      },
    });
    throw new ModelProvidersApiError(message, operation, error);
  }

  async list(): Promise<ModelProvidersListResponse> {
    const { data, error, response } = await this.apiClient.GET("/api/v1/model-providers");
    return unwrapApiResult({
      operation: "list model providers",
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }

  async set(
    provider: string,
    params: UpdateModelProviderBody,
  ): Promise<ModelProvidersListResponse> {
    const { data, error, response } = await this.apiClient.PUT(
      "/api/v1/model-providers/{provider}",
      {
        params: { path: { provider } },
        body: params,
      },
    );
    return unwrapApiResult({
      operation: `set model provider "${provider}"`,
      data,
      error,
      response,
      onError: this.handleApiError.bind(this),
    });
  }
}
