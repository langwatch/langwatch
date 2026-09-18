import { createOpenAI } from "@ai-sdk/openai";
import type {
  ModelProviderApi,
  ModelProviderStructuredGenerationInput,
} from "@langwatch/model-provider-contract";
import { generateObject } from "ai";

/** Executes feature-owned structured prompts without exposing a vendor model handle to peers. */
export class ModelProviderStructuredGenerationService {
  static create(input: {
    modelProviders: Pick<
      ModelProviderApi,
      "prepareExecution" | "resolveModelForFeature"
    >;
    executionProxyBaseUrl: string;
  }): ModelProviderStructuredGenerationService {
    return new ModelProviderStructuredGenerationService(input);
  }

  readonly #modelProviders: Pick<
    ModelProviderApi,
    "prepareExecution" | "resolveModelForFeature"
  >;
  readonly #executionProxyBaseUrl: string;

  private constructor(input: {
    modelProviders: Pick<
      ModelProviderApi,
      "prepareExecution" | "resolveModelForFeature"
    >;
    executionProxyBaseUrl: string;
  }) {
    this.#modelProviders = input.modelProviders;
    this.#executionProxyBaseUrl = input.executionProxyBaseUrl;
  }

  async generate(input: ModelProviderStructuredGenerationInput): Promise<unknown> {
    const resolved = await this.#modelProviders.resolveModelForFeature({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });
    const parameters = await this.#modelProviders.prepareExecution({
      projectId: input.projectId,
      model: resolved.model,
    });
    const headers = Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [`x-litellm-${key}`, value]),
    );
    const provider = createOpenAI({
      apiKey: parameters.api_key,
      baseURL: this.#executionProxyBaseUrl,
      headers,
    });
    const result = await generateObject({
      model: provider(parameters.model),
      schema: input.schema,
      system: input.system,
      prompt: input.prompt,
      maxRetries: input.maxRetries,
      abortSignal: AbortSignal.timeout(input.timeoutMs),
    });

    return result.object;
  }
}
