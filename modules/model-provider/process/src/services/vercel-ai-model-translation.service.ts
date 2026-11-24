import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { generateText } from "ai";

import { translationPrompt } from "../rules/translation-prompt.rules.ts";
import {
  ModelProviderExecutionHandleService,
  type ModelProviderExecutionHandleOptions,
} from "./model-provider-execution-handle.service.ts";

export abstract class ModelTranslation {
  abstract translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: Pick<
      ModelProviderApi,
      "resolveModelForFeature" | "findAlternateModel" | "getExecutionProviders"
    >;
  }): Promise<string>;
}

/**
 * One model call, asked to say the same thing in English.
 */
export class VercelAiModelTranslationService extends ModelTranslation {
  static create(
    options: Omit<ModelProviderExecutionHandleOptions, "modelProviders">,
  ): VercelAiModelTranslationService {
    return new VercelAiModelTranslationService(options);
  }

  private constructor(
    private readonly options: Omit<ModelProviderExecutionHandleOptions, "modelProviders">,
  ) {
    super();
  }

  async translate(input: {
    projectId: string;
    text: string;
    model: string;
    modelProviders: Pick<
      ModelProviderApi,
      "resolveModelForFeature" | "findAlternateModel" | "getExecutionProviders" | "prepareExecution"
    >;
  }): Promise<string> {
    const model = await ModelProviderExecutionHandleService.getVercelAIModel({
      ...this.options,
      modelProviders: input.modelProviders,
      projectId: input.projectId,
      model: input.model,
      featureKey: "translate.text",
    });
    const result = await generateText({ model, ...translationPrompt({ text: input.text }) });
    return result.text;
  }
}
