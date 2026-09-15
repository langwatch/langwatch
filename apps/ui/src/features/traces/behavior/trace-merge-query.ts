/**
 * Merges rather than replaces: the explorer's several writers (filter rail,
 * time range, lens, drawer, span selection) each set their own query keys in
 * the same tick, so a caller removes a key by writing `undefined`.
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
