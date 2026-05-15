import { getModelMetadata } from "~/server/modelProviders/registry";

import type { ApiResponsePrompt } from "../schemas/outputs";

/**
 * Sampling parameters exposed by the prompts REST API mapped to the
 * registry parameter name(s) that gate them. A field is dropped only when
 * the model is known to the registry and none of its gating parameters are
 * supported — e.g. `temperature` on the gpt-5 family, whose registry entry
 * lists `response_format`/`structured_outputs` but not `temperature`.
 */
const SAMPLING_PARAM_REGISTRY_NAMES: Record<string, readonly string[]> = {
  temperature: ["temperature"],
  maxTokens: ["max_tokens", "max_completion_tokens"],
};

/**
 * Removes sampling parameters the model provider would reject so a pull never
 * writes, for example, a `temperature` into local YAML that breaks the next
 * call against a gpt-5-family model. The platform is the single source of
 * truth here; the CLI just mirrors what the API returns.
 *
 * Conservative by design: unknown models (custom / not in the registry) keep
 * all parameters, since we can't prove they're unsupported.
 */
export const stripUnsupportedSamplingParams = <T extends ApiResponsePrompt>(
  prompt: T,
): T => {
  const metadata = getModelMetadata(prompt.model);
  if (!metadata) return prompt;

  const supported = new Set(metadata.supportedParameters);
  const next = { ...prompt };

  for (const [field, registryNames] of Object.entries(
    SAMPLING_PARAM_REGISTRY_NAMES,
  )) {
    const value = (next as Record<string, unknown>)[field];
    if (value === undefined || value === null) continue;
    const isSupported = registryNames.some((name) => supported.has(name));
    if (!isSupported) {
      delete (next as Record<string, unknown>)[field];
    }
  }

  return next;
};
