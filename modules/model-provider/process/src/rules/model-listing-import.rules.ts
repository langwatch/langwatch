/**
 * Merging a provider's model listing into its custom model lists. The import only adds: an entry
 * the user has, under either kind, stays as it is, and a model the endpoint stopped listing stays.
 * Spec: specs/model-providers/custom-provider-model-import.feature
 */
import type { Model } from "@langwatch/model-provider-contract";

import type { ListedModel } from "./model-listing.rules.ts";

export type MergedModelLists = {
  customModels: Model[];
  customEmbeddingsModels: Model[];
  /** How many entries this merge added. */
  added: number;
  /** The ids this listing carried, to store for the next merge. */
  listedModelIds: string[];
};

/**
 * Adds the listed models new since the previous listing to the chat and embedding lists. An id
 * the previous listing carried and the lists lack was removed by the user, so it is not added.
 */
export function mergeListedModels({
  listed,
  customModels,
  customEmbeddingsModels,
  previouslyListedIds,
}: {
  listed: readonly ListedModel[];
  customModels: readonly Model[];
  customEmbeddingsModels: readonly Model[];
  /** Ids the previous listing from this endpoint carried; null on a first listing. */
  previouslyListedIds: readonly string[] | null;
}): MergedModelLists {
  const known = new Set([...customModels, ...customEmbeddingsModels].map((model) => model.id));
  const seenBefore = new Set(previouslyListedIds ?? []);

  const addedChat: Model[] = [];
  const addedEmbeddings: Model[] = [];
  for (const model of listed) {
    if (known.has(model.id) || seenBefore.has(model.id)) continue;
    known.add(model.id);
    if (model.isEmbedding) {
      addedEmbeddings.push({ id: model.id, label: model.id, type: "embedding" });
    } else {
      addedChat.push(toChatModel(model));
    }
  }

  // Listings come in no useful order, so new entries are sorted by id to keep a long list scannable.
  return {
    customModels: [...customModels, ...sortById(addedChat)],
    customEmbeddingsModels: [...customEmbeddingsModels, ...sortById(addedEmbeddings)],
    added: addedChat.length + addedEmbeddings.length,
    listedModelIds: listed.map((model) => model.id),
  };
}

function sortById(models: Model[]): Model[] {
  return models.toSorted((left, right) => left.id.localeCompare(right.id));
}

function toChatModel(model: ListedModel): Model {
  return {
    id: model.id,
    label: model.id,
    type: "chat",
    ...(model.maxTokens !== undefined && { maxTokens: model.maxTokens }),
    ...(model.hasReasoning && { supportedParameters: ["reasoning"] }),
  };
}
