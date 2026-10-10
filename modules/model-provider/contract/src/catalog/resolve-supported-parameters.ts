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

/** `known` with `[]` is an explicit "no sampling knobs", distinct from `unknown` (#4429). */
export type SupportedParameters =
  | { kind: "known"; parameters: SupportedParameter[] }
  | { kind: "unknown" };

/** Precedence: operator override on the model, then the registry, then `unknown` (no filter). */
export function resolveSupportedParameters(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): SupportedParameters {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find((entry) => entry.modelId === modelName);
  if (custom?.supportedParameters !== undefined) {
    return { kind: "known", parameters: custom.supportedParameters };
  }
  const meta = pickModelMetadata(modelId);
  if (meta?.supportedParameters && meta.supportedParameters.length > 0) {
    return { kind: "known", parameters: meta.supportedParameters as SupportedParameter[] };
  }
  return { kind: "unknown" };
}

/**
 * Drop unsupported keys; `max_tokens` always survives (gateways require it regardless
 * of registry support), and an `unknown` model skips filtering entirely.
 */
export function filterUnsupportedSamplingParams<T extends Record<string, unknown>>(
  params: T,
  allowed: SupportedParameters,
): T {
  if (allowed.kind === "unknown") return params;
  const set = new Set<string>(allowed.parameters);
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
