import { generateText } from "ai";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ModelTranslation } from "../app/model-provider.infrastructure.ts";
import {
  ModelProviderExecutionHandleService,
  type ModelProviderExecutionHandleOptions,
} from "./model-provider-execution-handle.service.ts";

/**
 * One model call, asked to say the same thing in English.
 */
export class VercelAiModelTranslationAdapter extends ModelTranslation {
  static create(
    options: Omit<ModelProviderExecutionHandleOptions, "modelProviders">,
  ): VercelAiModelTranslationAdapter {
    return new VercelAiModelTranslationAdapter(options);
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
      "resolveModelForFeature" | "findAlternateModel" | "getExecutionProviders"
    >;
  }): Promise<string> {
    const model = await ModelProviderExecutionHandleService.getVercelAIModel({
      ...this.options,
      modelProviders: input.modelProviders,
      projectId: input.projectId,
      model: input.model,
      featureKey: "translate.text",
    });
    const result = await generateText({
      model,
      prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.text}`,
    });
    return result.text;
  }
}
