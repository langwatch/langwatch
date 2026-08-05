import type {
  CustomModelEntry,
  SupportedParameter,
} from "./customModel.schema";
import type { ModelEndpoint, ReasoningConfig } from "./llmModels.types";
import { llmModels } from "./loadModelCatalog";
import { getModelMetadata } from "./registry";

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

/**
 * What a dispatcher should do when it wants to send function tools to a
 * model on a given endpoint.
 *
 * - `allow` — send the request unchanged. This is the answer for every
 *   model that does not reason, and for the large majority of models that
 *   do (reasoning and tools coexist fine on them).
 * - `disable-reasoning` — the provider rejects the combination here, and
 *   the model lets reasoning be turned off. Pin `parameterName` to
 *   `value` and send the tools.
 * - `irreconcilable` — the provider rejects the combination here and the
 *   model cannot turn reasoning off, so no rewrite of this request can
 *   satisfy both. See the note on the constant below for what dispatchers
 *   do with it.
 */
export type ReasoningToolCompatibility =
  | { action: "allow" }
  | { action: "disable-reasoning"; parameterName: string; value: "none" }
  | { action: "irreconcilable"; parameterName: string };

const ALLOW_REASONING_TOOLS: ReasoningToolCompatibility = { action: "allow" };

/**
 * Resolve whether a model accepts reasoning together with function tools
 * on `endpoint`, and what to do if it does not.
 *
 * Three questions, in order, all of which have to be answered from the
 * registry rather than from a model-name pattern:
 *
 *   1. Does the model reason at all? (`reasoningConfig.supported`)
 *   2. Is reasoning incompatible with tools *on this endpoint*?
 *      (`reasoningConfig.toolsIncompatibleOn`)
 *   3. Can reasoning be disabled? (`reasoningConfig.canDisable`)
 *
 * Only all three true yields `disable-reasoning`. A blanket "strip
 * reasoning whenever tools are present" rule would answer question 1 and
 * skip the other two, silently downgrading every reasoning model that has
 * no problem with tools — which is nearly all of them.
 *
 * The caller supplies the *endpoint*, not the provider: the same model
 * behind the same provider answers differently on
 * `/v1/chat/completions` and `/v1/responses`.
 */
export function resolveReasoningToolCompatibility({
  modelId,
  endpoint,
}: {
  modelId: string;
  endpoint: ModelEndpoint;
}): ReasoningToolCompatibility {
  const reasoning: ReasoningConfig | undefined =
    llmModels.models[modelId]?.reasoningConfig;
  if (!reasoning?.supported) return ALLOW_REASONING_TOOLS;
  if (!reasoning.toolsIncompatibleOn?.includes(endpoint)) {
    return ALLOW_REASONING_TOOLS;
  }
  if (reasoning.canDisable) {
    return {
      action: "disable-reasoning",
      parameterName: reasoning.parameterName,
      value: "none",
    };
  }
  return { action: "irreconcilable", parameterName: reasoning.parameterName };
}

/**
 * Model ids that claim both a reasoning parameter and function tools but
 * carry no `reasoningConfig`, restricted to the models a dispatcher
 * treats as reasoning-class (the `IsReasoningModel` pattern mirrored in
 * `services/nlpgo/adapters/litellm/modelid.go`).
 *
 * Those are exactly the entries where the registry asserts a combination
 * works without ever having been asked whether it does — which is how the
 * gpt-5.6 family shipped claiming `reasoning_effort` *and* `tools` while
 * the provider rejects the pair on `/v1/chat/completions`. The registry is
 * regenerated from an upstream catalog that has no notion of the
 * constraint, so a new sibling arrives silently; this is the seam a test
 * watches.
 */
export function findUndeclaredReasoningModels(): string[] {
  return Object.entries(llmModels.models)
    .filter(([id, entry]) => isUndeclaredReasoningModel(id, entry))
    .map(([id]) => id)
    .sort();
}

const REASONING_CLASS = /^(o[1345]|gpt-5)(-(mini|nano))?/i;

function isUndeclaredReasoningModel(
  id: string,
  entry: { reasoningConfig?: unknown; supportedParameters?: string[] },
): boolean {
  if (entry.reasoningConfig) return false;
  const basename = id.split("/").slice(1).join("/") || id;
  if (!REASONING_CLASS.test(basename)) return false;
  const params = new Set(entry.supportedParameters ?? []);
  const claimsReasoning =
    params.has("reasoning") || params.has("reasoning_effort");
  const claimsTools = params.has("tools") || params.has("tool_choice");
  return claimsReasoning && claimsTools;
}
