import { generateText } from "ai";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelTranslationPort } from "../ports/model-provider.port";
import {
  getVercelAIModel,
  type ModelProviderExecutionHandleOptions,
} from "../services/model-provider-execution-handle.service";

/**
 * One model call, asked to say the same thing in English.
 *
 * The model is resolved through the ordinary cascade at the `translate.text`
 * feature key, so a project that pointed that key somewhere specific gets the
 * model it chose — and a project that configured nothing gets the same
 * "configure a default" refusal every other surface gives, rather than a
 * silently different model.
 *
 * The gateway arrives with the CALL rather than at construction, because the
 * service hands the port itself: composing this adapter over the service that
 * owns it would be a cycle, and the cycle is exactly what the port's parameter
 * exists to avoid.
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
    const model = await getVercelAIModel({
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
