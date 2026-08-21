/**
 * What a provider slot tells the gateway it serves.
 *
 * The gateway routes a bare model name to the provider that declares it, which
 * is what lets a customer call a model they configured without writing a
 * provider prefix. Two sources feed the list:
 *
 *   - the models the customer declared on the row (custom models and custom
 *     embeddings models), which is the only place a self-hosted or proxied
 *     model id is written down at all, and
 *   - for the hosted families, the model catalog the platform already ships,
 *     so "gpt-5-mini" reaches the OpenAI provider on a key that also holds
 *     Anthropic.
 *
 * This is a ROUTING vocabulary. It never widens what a key may call:
 * `models_allowed` stays the allowlist and is applied separately.
 */
import { llmModels } from "../modelProviders/loadModelCatalog";
import { toLegacyCompatibleCustomModels } from "../modelProviders/customModel.schema";

/**
 * Provider keys whose models the platform already knows, mapped to the prefix
 * those models carry in the shipped catalog (`llmModels.json` keys are written
 * "<family>/<model>").
 *
 * Only families whose model ids are stable and vendor-owned belong here. Groq
 * and Cerebras serve other vendors' open models under ids that change with
 * whatever the customer's account has, so shipping a list for them would claim
 * knowledge we do not have. They declare nothing and keep being reached the way
 * they always were.
 */
const HOSTED_CATALOG_PREFIXES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  deepseek: "deepseek",
  xai: "xai",
  voyage: "voyageai",
};

/**
 * Bare model ids per hosted family, computed once. The catalog keys carry the
 * family prefix and the gateway matches the id a caller actually sends, so the
 * prefix is stripped here rather than at every provider slot.
 */
const hostedCatalogByProvider = buildHostedCatalog();

function buildHostedCatalog(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [providerKey, prefix] of Object.entries(HOSTED_CATALOG_PREFIXES)) {
    const marker = `${prefix}/`;
    out[providerKey] = Object.keys(llmModels.models)
      .filter((id) => id.startsWith(marker))
      .map((id) => id.slice(marker.length))
      .filter((id) => id.length > 0);
  }
  return out;
}

/**
 * The model ids a provider row declares, deduplicated and sorted so the wire
 * payload, and therefore the config ETag, does not move when nothing changed.
 *
 * Returns undefined when the row declares nothing. That is deliberately
 * different from an empty list: a provider that has told the gateway nothing
 * cannot be ruled out by a model it does not list, and it stays a candidate for
 * a name no other provider claims.
 */
export function declaredModelsForProvider(mp: {
  provider: string;
  customModels: unknown;
  customEmbeddingsModels: unknown;
}): string[] | undefined {
  const declared = new Set<string>();

  for (const entry of toLegacyCompatibleCustomModels(mp.customModels, "chat")) {
    if (entry.modelId) declared.add(entry.modelId);
  }
  for (const entry of toLegacyCompatibleCustomModels(
    mp.customEmbeddingsModels,
    "embedding",
  )) {
    if (entry.modelId) declared.add(entry.modelId);
  }
  for (const id of hostedCatalogByProvider[mp.provider] ?? []) {
    declared.add(id);
  }

  if (declared.size === 0) return undefined;
  return [...declared].sort();
}
