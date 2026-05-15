import { getModelMetadata } from "~/server/modelProviders/registry";

/**
 * Sampling parameters as stored in `configData` (snake_case) mapped to the
 * registry parameter name(s) that gate them. A value is dropped only when the
 * model is known to the registry and none of its gating names are supported —
 * e.g. `temperature` on the gpt-5 family, whose registry entry lists
 * `response_format`/`structured_outputs` but not `temperature`.
 */
const SAMPLING_PARAM_REGISTRY_NAMES: Record<string, readonly string[]> = {
  temperature: ["temperature"],
  top_p: ["top_p"],
  frequency_penalty: ["frequency_penalty"],
  presence_penalty: ["presence_penalty"],
  top_k: ["top_k"],
  min_p: ["min_p"],
  repetition_penalty: ["repetition_penalty"],
};

/**
 * Write-boundary normalizer: a prompt version must never persist a sampling
 * parameter the model provider would reject. The platform editor can surface a
 * slider that materializes, say, `temperature: 0` even for a model that does
 * not support it; storing that is invalid data and later round-trips back into
 * local YAML as a value that breaks the next call.
 *
 * This does not invent or alter values — it only refuses to store one that
 * cannot validly exist for the chosen model. A legitimate user-set value on a
 * model that supports the parameter is untouched, and unknown / custom models
 * (not in the registry) keep everything, since we can't prove unsupport.
 *
 * Mutates and returns the same configData object.
 */
export const dropModelUnsupportedSamplingParams = <
  T extends { model?: string } & Record<string, unknown>,
>(
  configData: T,
): T => {
  if (!configData || typeof configData.model !== "string") return configData;

  const metadata = getModelMetadata(configData.model);
  if (!metadata) return configData;

  const supported = new Set(metadata.supportedParameters);

  for (const [param, registryNames] of Object.entries(
    SAMPLING_PARAM_REGISTRY_NAMES,
  )) {
    const value = configData[param];
    if (value === undefined || value === null) continue;
    const isSupported = registryNames.some((name) => supported.has(name));
    if (!isSupported) {
      delete configData[param];
    }
  }

  return configData;
};
