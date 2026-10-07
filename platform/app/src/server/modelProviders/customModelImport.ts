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
  | { status: "failed" }
  /** The organization used up its provider check budget; nothing was asked. */
  | { status: "skipped" };

export type MergedModelLists = {
  customModels: CustomModelEntry[];
  customEmbeddingsModels: CustomModelEntry[];
  /** How many entries this merge added. */
  added: number;
  /** The ids this listing carried, to store for the next merge. */
  listedModelIds: string[];
};

/**
 * Adds the listed models that are new since the previous listing to the
 * provider's chat and embedding lists, and returns the ids to store for the
 * next merge.
 */
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
    if (model.isEmbedding) {
      addedEmbeddings.push({
        modelId: model.id,
        displayName: model.id,
        mode: "embedding",
      });
    } else {
      addedChat.push(toChatEntry(model));
    }
  }

  // Listings come in no useful order (OpenAI's is not sorted), so new entries
  // are added sorted by id to keep a long list scannable.
  return {
    customModels: [...chat, ...sortById(addedChat)],
    customEmbeddingsModels: [...embeddings, ...sortById(addedEmbeddings)],
    added: addedChat.length + addedEmbeddings.length,
    listedModelIds: listed.map((model) => model.id),
  };
}

function sortById(entries: CustomModelEntry[]): CustomModelEntry[] {
  return [...entries].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

function toChatEntry(model: ListedModel): CustomModelEntry {
  return {
    modelId: model.id,
    displayName: model.id,
    mode: "chat",
    ...(model.maxTokens !== undefined && { maxTokens: model.maxTokens }),
    ...(model.hasReasoning && { supportedParameters: ["reasoning" as const] }),
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
  /** OpenAI's own base URL. Without one, an OpenAI provider never imports. */
  openAIDefaultBaseUrl: string | undefined;
}): boolean {
  if (provider === "custom") return true;
  if (provider !== "openai" || !baseUrl?.trim() || !openAIDefaultBaseUrl) {
    return false;
  }
  return !isSameEndpoint(baseUrl, openAIDefaultBaseUrl);
}

/**
 * Whether two base URLs name the same API root, ignoring case, trailing
 * slashes and a trailing `/v1`.
 */
export function isSameEndpoint(a: string, b: string): boolean {
  return apiRoot(a) === apiRoot(b);
}

/**
 * The base URL without trailing slashes or a trailing `/v1`. Scheme and host
 * compare case-insensitively; the path keeps its case, since a server may
 * route on it.
 */
function apiRoot(url: string): string {
  const trimmed = url.trim();
  let normalized: string;
  try {
    const parsed = new URL(trimmed);
    normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    normalized = trimmed;
  }
  return normalized
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/+$/, "");
}
