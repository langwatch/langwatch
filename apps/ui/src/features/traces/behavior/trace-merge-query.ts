/**
 * `setQuery` MERGES, and that is the one difference from every earlier family.
 * `UiRoutePort.setQuery` replaces the whole query, which is right for a screen
 * that owns its address; the explorer does not own its address alone — the
 * filter rail, the time range, the lens, the drawer and the span selection each
 * write their own keys, from different components, in the same tick. So the
 * merge happens here, over the reading, and a caller removes a key by writing
 * `undefined` exactly as it always did.
 */

export function mergeTraceQuery({
  current,
  next,
}: {
  current: Readonly<Record<string, string | undefined>>;
  next: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> {
  return { ...current, ...next };
}
