import {
  ModelProviderInvalidError,
  ModelProviderNotFoundError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import {
  type LiteLLMParams,
  LiteLLMParamsSchema,
  type ScenarioModelParametersFailureReason,
} from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:scenarios:model-parameters");

export type ModelParamsFailureReason = ScenarioModelParametersFailureReason;

export type ModelParamsResult =
  | { success: true; params: LiteLLMParams }
  | { success: false; reason: ModelParamsFailureReason; message: string };

export class ScenarioModelParametersService {
  static create(modelProviders: ModelProviderService): ScenarioModelParametersService {
    return new ScenarioModelParametersService(modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {}

  async prepare(input: { projectId: string; model: string }): Promise<ModelParamsResult> {
    const { projectId, model } = input;
    const providerKey = model.split("/")[0];
    if (!model.includes("/") || !providerKey) {
      return {
        success: false,
        reason: "invalid_model_format",
        message: `Invalid model format '${model}' - expected 'provider/model' format (e.g., 'openai/gpt-4')`,
      };
    }

    const provider = await this.modelProviders.tryGetProviderForProject({
      projectId,
      provider: providerKey,
    });
    if (provider && !provider.enabled) {
      return {
        success: false,
        reason: "provider_not_enabled",
        message: `Provider '${providerKey}' is not enabled for this project. Enable it in Settings > Model Providers.`,
      };
    }

    try {
      const params = LiteLLMParamsSchema.parse(
        await this.modelProviders.prepareExecution({ projectId, model }),
      );
      const hasCredentials = Boolean(
        params.api_key || params.vertex_credentials || params.aws_access_key_id,
      );
      if (!hasCredentials || !params.model) {
        const missing = [
          ...(!hasCredentials ? ["API key"] : []),
          ...(!params.model ? ["model"] : []),
        ];
        return {
          success: false,
          reason: "missing_params",
          message: `Provider '${providerKey}' is missing required configuration: ${missing.join(" and ")}. Check Settings > Model Providers.`,
        };
      }

      return { success: true, params };
    } catch (error) {
      if (error instanceof ModelProviderNotFoundError) {
        const providers = await this.modelProviders.getExecutionProviders({ projectId });
        const available = Object.keys(providers).join(", ") || "none";
        return {
          success: false,
          reason: "provider_not_found",
          message: `Provider '${providerKey}' not found for this project. Available providers: ${available}`,
        };
      }
      if (error instanceof ModelProviderInvalidError) {
        return {
          success: false,
          reason: "invalid_model_format",
          message: error.message,
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error }, "failed to prepare LiteLLM params");
      return {
        success: false,
        reason: "preparation_error",
        message: `Unexpected error preparing model params: ${message}`,
      };
    }
  }
}
