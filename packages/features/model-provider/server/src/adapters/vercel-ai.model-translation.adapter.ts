import { generateText } from "ai";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelTranslationPort } from "../ports/model-provider.port";
import {
  ModelProviderExecutionHandleService,
  type ModelProviderExecutionHandleOptions,
} from "../services/model-provider-execution-handle.service";

/**
 * One model call, asked to say the same thing in English.
 */
export class VercelAiModelTranslationAdapter extends ModelTranslationPort {
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
    modelProviders: ModelProviderService;
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
