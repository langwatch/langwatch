/**
 * Factory for creating Vercel AI models from LiteLLM parameters.
 *
 * Extracted to a shared module to eliminate duplication between
 * standalone-adapters.ts and scenario-worker.ts.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import type { LiteLLMParams } from "./types";

interface CreateModelFromParamsInput {
  litellmParams: LiteLLMParams;
  nlpServiceUrl: string;
}

// These are the exact Chat Completions models observed rejecting the scenario
// judge's forced function tool when reasoning is omitted. Do not broaden this
// to -pro or other providers without evidence: some models cannot disable
// reasoning, and the simulator/target do not necessarily use tools at all.
const JUDGE_MODELS_REQUIRING_DISABLED_REASONING = new Set<string>([
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
] as const);

/**
 * `/v1/chat/completions` rejects function tools on some reasoning models unless
 * reasoning is explicitly switched off ("Function tools with reasoning_effort
 * are not supported for <model> in /v1/chat/completions. To use function tools,
 * use /v1/responses or set reasoning_effort to 'none'."). The judge forces a
 * `finish_test` / `continue_test` tool call on every criteria-graded run, so on
 * such a model no run could reach a verdict — #6369, and the same signature in
 * the Python SDK judge, langwatch/scenario#864.
 *
 * Reasoning is disabled by RETRY, never preemptively: whether a model accepts
 * reasoning off is not knowable up front (Gemini 2.5 Pro rejects it with
 * "Budget 0 is invalid. This model only works in thinking mode."), so the
 * request is sent untouched and re-sent with reasoning off only when the
 * provider's rejection asks for exactly that. Models that work today are never
 * sent anything new.
 */
const REASONING_OFF = "none";

interface ProviderErrorBody {
  error?: { message?: unknown; param?: unknown };
}

/**
 * Whether a 400 is the provider telling us to turn reasoning off to use tools.
 * Keyed on the structured `param` field, with the remediation phrase as the
 * fallback for providers that omit it.
 */
function rejectionAsksForReasoningOff(body: string): boolean {
  let parsed: ProviderErrorBody;
  try {
    parsed = JSON.parse(body) as ProviderErrorBody;
  } catch {
    return false;
  }
  if (parsed.error?.param === "reasoning_effort") return true;
  const message = parsed.error?.message;
  return (
    typeof message === "string" &&
    message.includes("reasoning_effort") &&
    message.includes("'none'")
  );
}

/**
 * Wrap `fetch` to retry a tool-carrying request with reasoning declared off
 * when — and only when — the provider rejected it for exactly that reason.
 * A caller that asked for a specific effort keeps it and gets the endpoint's
 * own error, rather than having its intent silently rewritten.
 */
function withReasoningOffRetry(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);

    const body = init?.body;
    if (response.status !== 400 || typeof body !== "string") return response;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return response;
    }
    const carriesTools =
      Array.isArray(parsed.tools) && (parsed.tools as unknown[]).length > 0;
    if (!carriesTools || parsed.reasoning_effort !== undefined) return response;

    // Read the rejection from a clone so the original stays consumable if it
    // turns out to be some other 400.
    const rejection = await response.clone().text();
    if (!rejectionAsksForReasoningOff(rejection)) return response;

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
 * @returns A configured Vercel AI model instance
 */
export function createModelFromParams(input: CreateModelFromParamsInput) {
  const { litellmParams, nlpServiceUrl } = input;
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
    fetch: withReasoningOffRetry(globalThis.fetch.bind(globalThis)),
  });

  return vercelProvider(litellmParams.model);
}

/**
 * Creates the model used by Scenario's JudgeAgent.
 *
 * JudgeAgent always sends a forced function tool. The gpt-5.6 Chat
 * Completions models above enable reasoning when it is omitted, and reject
 * that combination. Supply `none` as a DEFAULT only for those judge models;
 * defaultSettingsMiddleware deep-merges call options over this value, so an
 * explicit future JudgeAgent option still wins rather than being silently
 * rewritten.
 */
export function createJudgeModelFromParams(input: CreateModelFromParamsInput) {
  const model = createModelFromParams(input);
  if (
    !JUDGE_MODELS_REQUIRING_DISABLED_REASONING.has(input.litellmParams.model)
  ) {
    return model;
  }

  const providerKey = input.litellmParams.model.split("/")[0];
  if (!providerKey) return model;

  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          [providerKey]: { reasoningEffort: "none" },
        },
      },
    }),
  });
}
