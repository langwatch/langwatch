/**
 * Factory for creating Vercel AI models from LiteLLM parameters.
 *
 * Extracted to a shared module to eliminate duplication between
 * standalone-adapters.ts and scenario-worker.ts.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LiteLLMParams } from "./types";

/**
 * Creates a Vercel AI model using pre-fetched LiteLLM params.
 *
 * @param litellmParams - The LiteLLM parameters including API key and model
 * @param nlpServiceUrl - The URL of the LangWatch NLP service for proxying
 * @returns A configured Vercel AI model instance
 */
export function createModelFromParams(
  litellmParams: LiteLLMParams,
  nlpServiceUrl: string,
) {
  const providerKey = litellmParams.model.split("/")[0];
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAICompatible({
    name: providerKey ?? "unknown",
    apiKey: litellmParams.api_key,
    baseURL: `${nlpServiceUrl}/proxy/v1`,
    headers,
  });

  return vercelProvider(litellmParams.model);
}
