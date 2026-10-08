/**
 * Which model the composer's picker should hold, from `reachable` — the project's models,
 * narrowed to providers connected at the project, team, or organization and the key's allowlist —
 * so the composer never seeds a model the gateway would refuse with `model_provider_not_bound`.
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
