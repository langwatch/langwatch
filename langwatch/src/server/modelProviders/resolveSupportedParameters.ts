import { getModelMetadata } from "./registry";
import type {
  CustomModelEntry,
  SupportedParameter,
} from "./customModel.schema";

type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

/**
 * Resolve the set of sampling parameters a model accepts.
 *
 * Order of precedence:
 *   1. Project-level `customModels[*].supportedParameters` override —
 *      explicit allowlist set by an operator on the Edit Model form.
 *   2. Built-in `llmModels.json` registry `supportedParameters`.
 *   3. `null` — model is unknown, callers MUST treat as "do not filter"
 *      so the legacy behavior of forwarding every set field is preserved.
 *
 * Returning an empty array `[]` is meaningful: it means the operator
 * has explicitly said "this model accepts no sampling knobs", so every
 * sampling field should be stripped. The caller distinguishes
 * `null` (no info) from `[]` (explicit empty) before filtering.
 *
 * Fix #4429 case: a Bedrock custom model with supportedParameters set
 * to `["temperature"]` was still receiving a leftover `top_p` from a
 * stale prompt-config blob, causing `temperature and top_p cannot both
 * be specified` from Bedrock. With the registry consulted at dispatch,
 * the `top_p` is dropped before the request leaves the control plane.
 */
export function resolveSupportedParameters(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): SupportedParameter[] | null {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find(
    (entry) => entry.modelId === modelName,
  );
  if (custom?.supportedParameters !== undefined) {
    return custom.supportedParameters;
  }
  const meta = getModelMetadata(modelId);
  if (meta?.supportedParameters && meta.supportedParameters.length > 0) {
    return meta.supportedParameters as SupportedParameter[];
  }
  return null;
}

/**
 * Drop every key in `params` that the model does not list as supported.
 * `max_tokens` is always preserved — it is a hard ceiling rather than a
 * sampling knob, and gateway-side dispatchers (anthropic, bedrock,
 * openai) all require it. Reasoning is keyed under both `reasoning`
 * and its mapped provider-specific name (e.g. `reasoning_effort`,
 * `thinkingLevel`); both clear together when the model can't reason.
 *
 * When `allowed` is `null` (model unknown), no filtering happens —
 * the caller sees the input untouched. This preserves legacy behavior
 * for any model we don't have metadata for yet.
 */
export function filterUnsupportedSamplingParams<
  T extends Record<string, unknown>,
>(params: T, allowed: SupportedParameter[] | null): T {
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
    if (
      k === "model" ||
      k === "messages" ||
      k === "tools" ||
      k === "response_format" ||
      k === "stream" ||
      k === "litellm_params"
    ) {
      out[k] = v;
      continue;
    }
    if (set.has(k)) {
      out[k] = v;
    }
  }
  return out as T;
}
