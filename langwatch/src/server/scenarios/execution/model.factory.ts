/**
 * Factory for creating Vercel AI models from LiteLLM parameters.
 *
 * Extracted to a shared module to eliminate duplication between
 * standalone-adapters.ts and scenario-worker.ts.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LiteLLMParams } from "./types";

/**
 * Creates a Vercel AI model using pre-fetched LiteLLM params.
 *
 * @param litellmParams - The LiteLLM parameters including API key and model
 * @param nlpServiceUrl - The URL of the LangWatch NLP service for proxying
 * @returns A configured Vercel AI model instance
 */
// Annotated with the provider INTERFACE, not the `LanguageModel` union from
// `ai`. That union is `GlobalProviderModelId | LanguageModelV3 |
// LanguageModelV2` — its string branch has no `.modelId`, so annotating with it
// breaks every caller that reads one. `LanguageModelV3` carries `modelId`, so
// the annotation is transparent to callers while making the type nameable for
// declaration emit (ADR-063 Phase 1).
export function createModelFromParams(
  litellmParams: LiteLLMParams,
  nlpServiceUrl: string,
): LanguageModelV3 {
  const providerKey = litellmParams.model.split("/")[0] || undefined;
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAICompatible({
    name: providerKey ?? "unknown",
    apiKey: litellmParams.api_key,
    baseURL: `${nlpServiceUrl}/go/proxy/v1`,
    headers,
  });

  return vercelProvider(litellmParams.model);
}
