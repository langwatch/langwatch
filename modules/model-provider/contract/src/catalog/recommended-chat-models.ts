import { pickRecommendedChatModel } from "./latest-aliases.ts";
import { getProviderModelOptions, isPickableCatalogModel } from "./model-catalog.ts";

/**
 * A provider's catalog chat models, its recommendation first.
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
export function findRecommendedChatModels({
  provider,
  limit,
}: {
  provider: string;
  limit: number;
}): string[] {
  const catalog = getProviderModelOptions(provider, "chat")
    .map((option) => option.value)
    .filter((model) => isPickableCatalogModel(`${provider}/${model}`));
  const recommended = pickRecommendedChatModel(provider)?.slice(provider.length + 1);
  const ordered = recommended
    ? [recommended, ...catalog.filter((model) => model !== recommended)]
    : catalog;
  return ordered.slice(0, limit);
}
