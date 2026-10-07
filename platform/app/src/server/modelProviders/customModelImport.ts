/**
 * Merging a provider's model listing into its custom model lists.
 *
 * The import only ever adds. An entry the user already has, under either
 * kind, is left exactly as it is, and a model the endpoint stopped listing
 * stays. A model the user removed is not brought back: the ids seen on the
 * previous listing are stored with the row, and only ids that are new since
 * then are imported.
 */
import type { CustomModelEntry, CustomModelsInput } from "./customModel.schema";
import { toLegacyCompatibleCustomModels } from "./customModel.schema";
import type { ListedModel } from "./modelListing";

/**
 * What a save did with the provider's model listing. Absent when the
 * provider does not import from one.
 */
export type ModelImportOutcome =
  | { status: "imported"; added: number; total: number }
  | { status: "failed" };

export type MergedModelLists = {
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
  /** How many entries this merge added. */
  added: number;
  /** The ids this listing carried, to store for the next merge. */
  listedModelIds: string[];
};

export function mergeListedModels({
  listed,
  customModels,
  customEmbeddingsModels,
  previouslyListedIds,
}: {
  listed: ListedModel[];
  customModels: CustomModelsInput | null | undefined;
  customEmbeddingsModels: CustomModelsInput | null | undefined;
  /** Ids the previous listing carried. Null on a row never listed before. */
  previouslyListedIds: readonly string[] | null | undefined;
}): MergedModelLists {
  const chat = toLegacyCompatibleCustomModels(customModels ?? null, "chat");
  const embeddings = toLegacyCompatibleCustomModels(
    customEmbeddingsModels ?? null,
    "embedding",
  );
  const known = new Set([...chat, ...embeddings].map((entry) => entry.modelId));
  const seenBefore = new Set(previouslyListedIds ?? []);

  const addedChat: CustomModelEntry[] = [];
  const addedEmbeddings: CustomModelEntry[] = [];
  for (const model of listed) {
    if (known.has(model.id) || seenBefore.has(model.id)) continue;
    known.add(model.id);
    if (model.embedding) {
      addedEmbeddings.push({
        modelId: model.id,
        displayName: model.id,
        mode: "embedding",
      });
    } else {
      addedChat.push(toChatEntry(model));
    }
  }

  return {
    customModels: [...chat, ...addedChat],
    customEmbeddingsModels: [...embeddings, ...addedEmbeddings],
    added: addedChat.length + addedEmbeddings.length,
    listedModelIds: listed.map((model) => model.id),
  };
}

function toChatEntry(model: ListedModel): CustomModelEntry {
  return {
    modelId: model.id,
    displayName: model.id,
    mode: "chat",
    ...(model.maxTokens !== undefined && { maxTokens: model.maxTokens }),
    ...(model.reasoning && { supportedParameters: ["reasoning" as const] }),
  };
}

/** Reads the stored id list, ignoring anything that is not a string array. */
export function readListedModelIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((id): id is string => typeof id === "string");
}

/**
 * Whether saving this provider imports from its model listing: every custom
 * (OpenAI-compatible) provider, and an OpenAI provider pointed at a base URL
 * other than OpenAI's own, which is the same kind of endpoint under another
 * name. OpenAI itself is left out because its models come from the catalog.
 */
export function importsModelListing({
  provider,
  baseUrl,
  openAIDefaultBaseUrl,
}: {
  provider: string;
  baseUrl: string | undefined;
  openAIDefaultBaseUrl: string;
}): boolean {
  if (provider === "custom") return true;
  if (provider !== "openai" || !baseUrl?.trim()) return false;
  return apiRoot(baseUrl) !== apiRoot(openAIDefaultBaseUrl);
}

function apiRoot(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/+$/, "");
}
