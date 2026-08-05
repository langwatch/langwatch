/**
 * Factory for creating Vercel AI models from LiteLLM parameters.
 *
 * Extracted to a shared module to eliminate duplication between
 * standalone-adapters.ts and scenario-worker.ts.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LiteLLMParams } from "./types";

/**
 * `/v1/chat/completions` rejects function tools on a reasoning model unless
 * reasoning is explicitly switched off ("Function tools with reasoning_effort
 * are not supported for <model> in /v1/chat/completions. To use function tools,
 * use /v1/responses or set reasoning_effort to 'none'."). The judge forces a
 * `finish_test` / `continue_test` tool call on every criteria-graded run, so on
 * such a model no run could reach a verdict — #6369, and the same signature in
 * the Python SDK judge, langwatch/scenario#864.
 */
const REASONING_OFF = "none";

export interface CreateModelOptions {
  /**
   * Whether the target model accepts `reasoning_effort`. Resolved in the parent
   * process, which owns the model registry and the project's custom-model
   * overrides; the spawned worker has neither. Left `false` when unknown, so an
   * unrecognised model is sent exactly what it is sent today.
   */
  modelSupportsReasoningEffort?: boolean;
}

/**
 * Wrap `fetch` so any request carrying function tools also declares reasoning
 * off. Only fills the gap — a caller that asked for a specific effort keeps it
 * and gets the endpoint's own error, rather than having its intent silently
 * rewritten.
 */
function withReasoningDisabledForToolCalls(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const body = init?.body;
    if (typeof body !== "string") {
      return baseFetch(input, init);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return baseFetch(input, init);
    }

    const carriesTools =
      Array.isArray(parsed.tools) && (parsed.tools as unknown[]).length > 0;
    if (!carriesTools || parsed.reasoning_effort !== undefined) {
      return baseFetch(input, init);
    }

    return baseFetch(input, {
      ...init,
      body: JSON.stringify({ ...parsed, reasoning_effort: REASONING_OFF }),
    });
  };
}

/**
 * Creates a Vercel AI model using pre-fetched LiteLLM params.
 *
 * @param litellmParams - The LiteLLM parameters including API key and model
 * @param nlpServiceUrl - The URL of the LangWatch NLP service for proxying
 * @param options - Transport traits the parent process resolved for this model
 * @returns A configured Vercel AI model instance
 */
export function createModelFromParams(
  litellmParams: LiteLLMParams,
  nlpServiceUrl: string,
  options: CreateModelOptions = {},
) {
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
    ...(options.modelSupportsReasoningEffort
      ? {
          fetch: withReasoningDisabledForToolCalls(
            globalThis.fetch.bind(globalThis),
          ),
        }
      : {}),
  });

  return vercelProvider(litellmParams.model);
}
