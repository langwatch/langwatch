import { DEFAULT_PROVIDER_MAPPING, type ProviderMapping } from "@langwatch/model-provider-contract";

/**
 * Maps an OpenRouter-shaped model id (`provider/name`) onto the catalog's
 * provider naming and, for providers whose API rejects dotted version
 * segments, a dash-normalized model name.
 */

/** Provider segment of a model id, e.g. "openai" from "openai/gpt-5". */
export function extractProvider(modelId: string): string {
  const parts = modelId.split("/");
  return parts[0] ?? modelId;
}

/** Maps a provider name from OpenRouter format to the catalog's format. */
export function mapProviderName(
  provider: string,
  customMapping: ProviderMapping = DEFAULT_PROVIDER_MAPPING,
): string {
  return customMapping[provider] ?? provider;
}

/**
 * Providers whose APIs reject version-style dots in the model name segment
 * (e.g. Anthropic accepts `claude-opus-4-5` but rejects `claude-opus-4.5`).
 * Anthropic-only by design — a universal rewrite risks breaking a working id.
 */
const DOT_NORMALIZED_PROVIDERS = ["anthropic"];

/**
 * Normalizes digit-dot-digit version segments to digit-dash-digit for
 * `DOT_NORMALIZED_PROVIDERS`. Anchored on digits both sides so non-version
 * dots (`model-v0.1`, `name.beta`) are left untouched.
 */
export function normalizeModelName(provider: string, modelName: string): string {
  if (!DOT_NORMALIZED_PROVIDERS.includes(provider)) return modelName;
  return modelName.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

/**
 * Maps a full model id onto the catalog's provider format and a
 * provider-callable model name (provider mapping always; dotted-version
 * normalization for Anthropic only).
 */
export function mapModelId(
  modelId: string,
  customMapping: ProviderMapping = DEFAULT_PROVIDER_MAPPING,
): string {
  const provider = extractProvider(modelId);
  const mappedProvider = mapProviderName(provider, customMapping);
  const modelName = modelId.slice(provider.length + 1);
  const normalizedName = normalizeModelName(mappedProvider, modelName);

  if (mappedProvider === provider && normalizedName === modelName) {
    return modelId;
  }

  return `${mappedProvider}/${normalizedName}`;
}

/** Every unique provider segment across a list of model ids, sorted. */
export function getUniqueProviders(modelIds: string[]): string[] {
  const providers: string[] = [];
  for (const id of modelIds.map(extractProvider)) {
    if (!providers.includes(id)) providers.push(id);
  }
  return providers.sort();
}

/** Known routing variant suffixes filtered from the registry. */
export const KNOWN_VARIANT_SUFFIXES = ["free", "thinking", "extended", "beta"];

/** Whether a model id carries a variant suffix (`:free`, `:thinking`, ...). */
export function hasVariantSuffix(modelId: string): boolean {
  const colonIndex = modelId.lastIndexOf(":");
  if (colonIndex === -1) return false;
  const suffix = modelId.substring(colonIndex + 1);
  if (/^\d+$/.test(suffix)) return false;
  return KNOWN_VARIANT_SUFFIXES.includes(suffix.toLowerCase());
}
