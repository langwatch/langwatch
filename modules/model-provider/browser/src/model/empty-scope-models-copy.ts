/**
 * Why a Default models picker lists nothing at the picked scopes, in the reader's words.
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import type { EmptyScopeProvider } from "@langwatch/model-provider-contract";

type Kind = "chat" | "embedding";

function namesOf(providers: readonly EmptyScopeProvider[]): string {
  const names = [...new Set(providers.map((provider) => provider.name))];
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Azure calls what it serves a deployment; every other provider, a model. */
function nounOf(providers: readonly EmptyScopeProvider[]): string {
  return providers.every((provider) => provider.provider === "azure") ? "deployment" : "model";
}

/** Names the providers that list only what is added to them and have none of this kind. */
export function emptyProvidersCopy({
  providers,
  kind,
}: {
  providers: readonly EmptyScopeProvider[];
  kind: Kind;
}): string {
  const noun = nounOf(providers);
  const isOne = new Set(providers.map((provider) => provider.name)).size === 1;
  return (
    `${namesOf(providers)} ${isOne ? "lists" : "list"} only the ${noun}s you add, and ` +
    `${isOne ? "has" : "have"} no ${kind} ${noun} yet. Add one to pick it here.`
  );
}

/** No provider at the picked scopes offers this kind, and none is waiting on an added model. */
export function noProviderCopy({ kind }: { kind: Kind }): string {
  if (kind === "embedding") {
    return "No provider at these scopes offers an embedding model. Add one that does (OpenAI, Voyage, Cohere) to use topic clustering and semantic search.";
  }
  return "No provider at these scopes offers a chat model. Add a model provider to pick one here.";
}

export function openProviderLabel({ provider }: { provider: EmptyScopeProvider }): string {
  return `Open ${provider.name}`;
}
