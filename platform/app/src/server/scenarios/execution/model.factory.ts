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
