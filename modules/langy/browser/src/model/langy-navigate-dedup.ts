/**
 * At-most-once guard for an agent-driven navigate instruction.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */

/** The dedup key for one navigate instruction: the turn it belongs to, plus
 * the resolved destination — the closest thing to an id a bare entry has. */
export function navigateDedupKey({
  turnId,
  href,
}: {
  turnId: string | null;
  href: string;
}): string {
  return `${turnId ?? ""}:${href}`;
}

/**
 * Reserve `key` in `seen`. Returns true the FIRST time a key is reserved (the caller
 * should act on it), false every time after (a replay — drop it). Mutates `seen` as its
 * side effect, mirroring the server-side frame-nonce dedup's `SADD`-then-check shape.
 */
export function reserveNavigate({ seen, key }: { seen: Set<string>; key: string }): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
