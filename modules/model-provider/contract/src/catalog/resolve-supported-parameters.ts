import type { CustomModelEntry, SupportedParameter } from "../custom-model.ts";
import { pickModelMetadata } from "./model-catalog.ts";

type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

const ALWAYS_PASSED_THROUGH_PARAMS = new Set([
  "model",
  "messages",
  "tools",
  "response_format",
  "stream",
  "litellm_params",
]);

/**
 * Precedence: operator override on the model, then the registry, then `null` (unknown,
 * do not filter). `[]` is a distinct explicit "no sampling knobs" from `null` (#4429).
 */
export function resolveSupportedParameters(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): SupportedParameter[] | null {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find((entry) => entry.modelId === modelName);
  if (custom?.supportedParameters !== undefined) {
    return custom.supportedParameters;
  }
  const meta = pickModelMetadata(modelId);
  if (meta?.supportedParameters && meta.supportedParameters.length > 0) {
    return meta.supportedParameters as SupportedParameter[];
  }
  return null;
}

/**
 * Drop unsupported keys; `max_tokens` always survives (gateways require it regardless
 * of registry support), and `null` (model unknown) skips filtering entirely.
 */
export function filterUnsupportedSamplingParams<T extends Record<string, unknown>>(
  params: T,
  allowed: SupportedParameter[] | null,
): T {
  if (allowed === null) return params;
  const set = new Set<string>(allowed);
  // max_tokens is a hard ceiling, not a sampling knob; gateways need it
  // regardless of whether the model "supports" it via this registry.
  set.add("max_tokens");
  // When reasoning is allowed, allow every provider-specific alias too
  // so map_reasoning_to_provider's output (reasoning_effort /
  // thinkingLevel / effort) survives the filter.
  if (set.has("reasoning")) {
    set.add("reasoning_effort");
    set.add("thinkingLevel");
    set.add("effort");
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const isAlwaysPassedThrough = ALWAYS_PASSED_THROUGH_PARAMS.has(k);
    if (isAlwaysPassedThrough) {
      out[k] = v;
      continue;
    }
    if (set.has(k)) {
      out[k] = v;
    }
  }
  return out as T;
}
