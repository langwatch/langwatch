/**
 * Which model the composer's picker should hold.
 *
 * The panel used to check the resolved default against the virtual key's
 * `modelsAllowed` list only. That list is null on almost every project, which
 * reads as "anything goes", so a default naming a provider the project has no
 * credential for went straight into the composer. The picker's own menu never
 * offers such a model, and the gateway refuses it with
 * `model_provider_not_bound` on every send.
 *
 * `reachable` is the list the picker renders: the project's models, from the
 * providers connected at the project, its team or its organization, already
 * narrowed by the key's allowlist. Seeding and snapping run on that list, so
 * the composer and the turn agree on what the project can serve.
 */
export function resolveComposerModel({
  current,
  resolvedDefault,
  reachable,
}: {
  /** The model the composer holds now, empty when nothing is chosen yet. */
  current: string;
  /** The model the project's Langy configuration resolves to. */
  resolvedDefault: string | null | undefined;
  /** Models the project can serve, in menu order. */
  reachable: readonly string[];
}): string | null {
  // Nothing to choose from: the provider query is still in flight, or the
  // project has no provider connected at all. Leave the composer alone, since
  // the panel's own inline setup covers the second case.
  if (reachable.length === 0) return null;

  if (current) return reachable.includes(current) ? null : reachable[0]!;

  if (resolvedDefault && reachable.includes(resolvedDefault)) {
    return resolvedDefault;
  }
  return reachable[0]!;
}
