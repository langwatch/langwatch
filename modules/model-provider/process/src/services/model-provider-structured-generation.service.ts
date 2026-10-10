import type { ModelProviderStructuredGenerationInput } from "@langwatch/model-provider-contract";
import { generateObject } from "ai";

import type { ModelProviderExecutionHandleService } from "./model-provider-execution-handle.service.ts";

/** Executes feature-owned structured prompts without exposing a vendor model handle to peers. */
export class ModelProviderStructuredGenerationService {
  static create(input: {
    execution: ModelProviderExecutionHandleService;
  }): ModelProviderStructuredGenerationService {
    return new ModelProviderStructuredGenerationService(input.execution);
  }

  readonly #execution: ModelProviderExecutionHandleService;

  private constructor(execution: ModelProviderExecutionHandleService) {
    this.#execution = execution;
  }

  async generate(input: ModelProviderStructuredGenerationInput): Promise<unknown> {
    const model = await this.#execution.resolve({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });
    const result = await generateObject({
      model,
      schema: input.schema,
      system: input.system,
      prompt: input.prompt,
      maxRetries: input.maxRetries,
      abortSignal: AbortSignal.timeout(input.timeoutMs),
    });

    return input.schema.parse(result.object);
  }
}
