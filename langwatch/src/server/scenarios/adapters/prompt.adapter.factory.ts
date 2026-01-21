/**
 * Factory for creating prompt-based scenario adapters.
 */

import type { LiteLLMParams, PromptConfigData } from "../execution/types";
import { SerializedPromptConfigAdapter } from "../execution/serialized.adapters";
import { SCENARIO_DEFAULTS } from "../scenario.constants";
import type {
  AdapterCreationContext,
  AdapterResult,
  TargetAdapterFactory,
} from "./adapter.types";

/** Interface for prompt lookup - allows DI for testing */
export interface PromptLookup {
  getPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
  }): Promise<{
    id: string;
    prompt: string;
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } | null>;
}

/** Interface for model params preparation - allows DI for testing */
export interface ModelParamsProvider {
  prepare(projectId: string, model: string): Promise<LiteLLMParams | null>;
}

export class PromptAdapterFactory implements TargetAdapterFactory {
  constructor(
    private readonly promptLookup: PromptLookup,
    private readonly modelParamsProvider: ModelParamsProvider,
  ) {}

  supports(type: string): boolean {
    return type === "prompt";
  }

  async create(context: AdapterCreationContext): Promise<AdapterResult> {
    const { projectId, target, nlpServiceUrl } = context;

    const prompt = await this.promptLookup.getPromptByIdOrHandle({
      idOrHandle: target.referenceId,
      projectId,
    });

    if (!prompt) {
      return {
        success: false,
        error: `Prompt ${target.referenceId} not found`,
      };
    }

    const promptModel = prompt.model ?? SCENARIO_DEFAULTS.MODEL;
    const promptParams = await this.modelParamsProvider.prepare(
      projectId,
      promptModel,
    );

    if (!promptParams) {
      return {
        success: false,
        error: `Failed to prepare model params for ${promptModel}`,
      };
    }

    const config: PromptConfigData = {
      type: "prompt",
      promptId: prompt.id,
      systemPrompt: prompt.prompt,
      messages: (prompt.messages ?? []) as PromptConfigData["messages"],
      model: promptModel,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };

    return {
      success: true,
      adapter: new SerializedPromptConfigAdapter(
        config,
        promptParams,
        nlpServiceUrl,
      ),
    };
  }
}
