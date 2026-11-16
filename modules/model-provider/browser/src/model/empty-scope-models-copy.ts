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

/** Every picked scope offers models of this kind, but no one model is offered by all of them. */
export function sharesNoneCopy({ kind }: { kind: Kind }): string {
  return (
    `No ${kind} model is offered by every picked scope. Each offers some, but a config runs ` +
    `only a model all of its scopes offer: pick fewer scopes or give them a provider in common.`
  );
}

/** The scopes' models read was refused: the reader may not view one of the picked scopes. */
export const SCOPE_MODELS_REFUSED_COPY =
  "You can't view one of the picked scopes, so its models can't be listed here.";

/** The scopes' models read failed for any other reason; it can be tried again. */
export const SCOPE_MODELS_FAILED_COPY = "Couldn't load the models for the picked scopes.";

export function openProviderLabel({ provider }: { provider: EmptyScopeProvider }): string {
  return `Open ${provider.name}`;
}
