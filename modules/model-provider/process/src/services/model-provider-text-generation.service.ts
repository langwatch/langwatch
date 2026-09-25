import {
  findFeatureByKey,
  type ModelProviderTextGenerationInput,
} from "@langwatch/model-provider-contract";
import { generateText } from "ai";

import type { AiCallFailureService } from "./ai-call-failure.service.ts";
import type { ModelProviderExecutionHandleService } from "./model-provider-execution-handle.service.ts";

/** Runs feature-owned plain-text completions without exposing a vendor model handle to peers. */
export class ModelProviderTextGenerationService {
  static create(input: {
    execution: ModelProviderExecutionHandleService;
    aiCallFailures: AiCallFailureService;
  }): ModelProviderTextGenerationService {
    return new ModelProviderTextGenerationService(input.execution, input.aiCallFailures);
  }

  readonly #execution: ModelProviderExecutionHandleService;
  readonly #aiCallFailures: AiCallFailureService;

  private constructor(
    execution: ModelProviderExecutionHandleService,
    aiCallFailures: AiCallFailureService,
  ) {
    this.#execution = execution;
    this.#aiCallFailures = aiCallFailures;
  }

  async generate(input: ModelProviderTextGenerationInput): Promise<{ text: string }> {
    const feature = findFeatureByKey(input.featureKey)[0];
    // A missing registry entry is a build-time mistake, not a customer-actionable cause.
    if (!feature) throw new Error(`${input.featureKey} feature is not registered`);

    return this.#aiCallFailures.wrapAiCall(feature, async () => {
      const model = await this.#execution.resolve({
        projectId: input.projectId,
        featureKey: input.featureKey,
      });
      const completion = await generateText({
        model,
        system: input.system,
        messages: input.messages.map((message) => ({ ...message })),
        ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.reasoningEffort === undefined
          ? {}
          : { providerOptions: { openai: { reasoningEffort: input.reasoningEffort } } }),
      });

      return { text: completion.text };
    });
  }
}
