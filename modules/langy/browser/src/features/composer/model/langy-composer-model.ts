import { pickNewestChatModel } from "@langwatch/model-provider-contract";

/**
 * Which model the composer's picker should hold, from `reachable` — the project's models,
 * narrowed to providers connected at the project, team, or organization and the key's allowlist —
 * so the composer never seeds a model the gateway would refuse with `model_provider_not_bound`.
 */
export function resolveComposerModel({
  current,
  resolvedDefault,
  resolvedDefaultSettled,
  reachable,
  seedFollowsDefault = false,
}: {
  /** The model the composer holds now, empty when nothing is chosen yet. */
  current: string;
  /** The model the project's Langy configuration resolves to. */
  resolvedDefault: string | null | undefined;
  /** False while the resolved default loads, so the menu's first model never wins the race. */
  resolvedDefaultSettled: boolean;
  /** Models the project can serve, in menu order. */
  reachable: readonly string[];
  /**
   * The composer holds a seed, neither the user's pick nor the model a reopened conversation
   * last ran on, so it keeps following the resolved default.
   */
  seedFollowsDefault?: boolean;
}): string | null {
  // Nothing to choose from: the provider query is still in flight, or the
  // project has no provider connected at all. Leave the composer alone, since
  // the panel's own inline setup covers the second case.
  if (reachable.length === 0) return null;

  const servedDefault =
    resolvedDefaultSettled && resolvedDefault && reachable.includes(resolvedDefault)
      ? resolvedDefault
      : null;
  if (current) {
    if (!reachable.includes(current)) return servedDefault ?? fallbackModel(reachable);
    // A seed taken while the default was out of reach (the menu answered first, or narrowed
    // later) gives way to the default once the project serves it.
    return seedFollowsDefault && servedDefault && servedDefault !== current ? servedDefault : null;
  }
  if (!resolvedDefaultSettled) return null;
  return servedDefault ?? fallbackModel(reachable);
}

/**
 * The menu's first provider keeps the turn, but on the newest model it lists: a provider's
 * saved order puts whatever was added first on top, which may be a model it has since retired.
 */
function fallbackModel(reachable: readonly string[]): string {
  const provider = providerOf(reachable[0]!);
  const ofProvider = reachable.filter((model) => providerOf(model) === provider);
  return pickNewestChatModel({ models: ofProvider }) ?? reachable[0]!;
}

function providerOf(model: string): string {
  return model.split("/")[0] ?? model;
}

/**
 * The resolved default the composer cannot run on: no connected provider serves it once every
 * model read answered. The panel names it rather than switching models without a word.
 */
export function unservedDefaultModel({
  resolvedDefault,
  settled,
  reachable,
}: {
  resolvedDefault: string | null | undefined;
  settled: boolean;
  reachable: readonly string[];
}): string | null {
  if (!settled || !resolvedDefault || reachable.length === 0) return null;
  return reachable.includes(resolvedDefault) ? null : resolvedDefault;
}
