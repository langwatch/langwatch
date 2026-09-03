import { llmModels, toLegacyCompatibleCustomModels } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:gateway:provider-model-catalog");

const HOSTED_CATALOG_PREFIXES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  deepseek: "deepseek",
  xai: "xai",
  voyage: "voyageai",
};

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

export function declaredModelsForProvider(mp: {
  provider: string;
  customModels: unknown;
  customEmbeddingsModels: unknown;
}): string[] | undefined {
  const declared = new Set<string>();

  const chat = toLegacyCompatibleCustomModels(mp.customModels, "chat");
  const embeddings = toLegacyCompatibleCustomModels(mp.customEmbeddingsModels, "embedding");
  for (const entry of [...chat.entries, ...embeddings.entries]) {
    if (entry.modelId) declared.add(entry.modelId);
  }
  const rejected = [...chat.rejected, ...embeddings.rejected];
  if (rejected.length > 0) {
    logger.warn(
      { provider: mp.provider, rejected: rejected.map((entry) => entry.name) },
      "dropped unroutable custom model entries that failed the strict parse",
    );
  }
  for (const id of hostedCatalogByProvider[mp.provider] ?? []) {
    declared.add(id);
  }

  if (declared.size === 0) return void 0;
  return [...declared].sort();
}
