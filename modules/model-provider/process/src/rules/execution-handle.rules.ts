import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * The handle for prepared parameters: they travel as `x-litellm-*` headers to nlpgo's in-process
 * gateway proxy. Shared by execution and the connection ping so the two cannot drift on how a
 * credential reaches the wire.
 */
export function handleForParameters(input: {
  providerKey: string;
  model: string;
  parameters: Record<string, string>;
  executionProxyBaseUrl: string;
}): LanguageModel {
  const headers = Object.fromEntries(
    Object.entries(input.parameters).map(([key, value]) => [`x-litellm-${key}`, value]),
  );
  const vercelProvider = createOpenAICompatible({
    name: input.providerKey,
    apiKey: input.parameters.api_key,
    baseURL: input.executionProxyBaseUrl,
    headers,
  });

  return vercelProvider(input.model);
}
