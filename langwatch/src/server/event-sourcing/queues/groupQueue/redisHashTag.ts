/**
 * Whether a key (or key prefix) carries a Redis Cluster hash tag — a non-empty
 * `{…}` whose content alone decides the slot. The GroupQueue's multi-key Lua
 * (and the holder release/transfer evals) require their keys in one slot, so a
 * tag is mandatory in cluster mode. Mirrors Redis's rule: the first `{`, the
 * first `}` after it, and at least one character between them.
 */
export function hasRedisHashTag(name: string): boolean {
  const open = name.indexOf("{");
  if (open === -1) return false;
  const close = name.indexOf("}", open + 1);
  return close > open + 1;
}
