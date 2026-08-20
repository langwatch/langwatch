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
 * Reasoning is disabled by RETRY as the general mechanism: whether a model
 * accepts reasoning off is not knowable up front (Gemini 2.5 Pro rejects it
 * with "Budget 0 is invalid. This model only works in thinking mode."), so the
 * request is sent untouched and re-sent with reasoning off only when the
 * provider's rejection asks for exactly that. Models that work today are never
 * sent anything new. `createJudgeModelFromParams` additionally defaults
 * reasoning off preemptively for the exact models already observed to require
 * it (#6620), which skips the wasted rejected round-trip on every judge turn;
 * the retry stays as the net for models nobody has listed yet.
 */
const REASONING_OFF = "none";

/** The parameter a provider names when the reasoning setting is what it refused. */
const REASONING_EFFORT_PARAM = "reasoning_effort";

/**
 * How a provider spells the value it is asking for. The quotes are what
 * separate a remediation ("set reasoning_effort to 'none'") from prose that
 * merely contains the word.
 */
const REQUESTED_REASONING_OFF = [
  `'${REASONING_OFF}'`,
  `"${REASONING_OFF}"`,
] as const;

interface ProviderErrorBody {
  error?: { message?: unknown; param?: unknown };
}

/**
 * Whether a 400 is the provider telling us to turn reasoning off to use tools.
 *
 * Two signals, and both are required: the rejection has to be about the
 * reasoning setting (the structured `param`, or the parameter named in the
 * prose), AND its remediation has to ask for reasoning off by quoting the value
 * to send. `param` alone is not that signal — a provider reports a missing,
 * invalid or unsupported reasoning setting under the same `param`, and
 * answering any of those by re-sending the request with a value nobody asked
 * for rewrites the caller's request on a guess.
 */
function rejectionAsksForReasoningOff(body: string): boolean {
  let parsed: ProviderErrorBody;
  try {
    parsed = JSON.parse(body) as ProviderErrorBody;
  } catch {
    return false;
  }
  // JSON.parse happily returns null or a primitive for bodies like "null".
  if (typeof parsed !== "object" || parsed === null) return false;

  const message =
    typeof parsed.error?.message === "string" ? parsed.error.message : "";
  const isAboutReasoningEffort =
    parsed.error?.param === REASONING_EFFORT_PARAM ||
    message.includes(REASONING_EFFORT_PARAM);

  return (
    isAboutReasoningEffort &&
    REQUESTED_REASONING_OFF.some((quoted) => message.includes(quoted))
  );
}

/**
 * The parsed request body, when the request is one the retry may rewrite: a
 * tool-carrying JSON body with no reasoning effort of its own. A caller that
 * asked for a specific effort keeps it and gets the endpoint's own error,
 * rather than having its intent silently rewritten.
 */
function retryEligibleRequestBody(
  init: RequestInit | undefined,
): Record<string, unknown> | undefined {
  const body = init?.body;
  if (typeof body !== "string") return undefined;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const hasTools =
    Array.isArray(parsed.tools) && (parsed.tools as unknown[]).length > 0;
  if (!hasTools || parsed.reasoning_effort !== undefined) return undefined;
  return parsed;
}

/**
 * Wrap `fetch` to retry a tool-carrying request with reasoning declared off
 * when — and only when — the provider rejected it for exactly that reason.
 */
function withReasoningOffRetry(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 400) return response;

    const parsed = retryEligibleRequestBody(init);
    if (!parsed) return response;

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
