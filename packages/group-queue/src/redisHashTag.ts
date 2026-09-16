/**
 * Whether a key carries a Redis Cluster hash tag — a non-empty `{…}` whose
 * content alone decides the slot. Mandatory in cluster mode, since the
 * GroupQueue's multi-key Lua requires its keys in one slot.
 */
export function hasRedisHashTag(name: string): boolean {
  const open = name.indexOf("{");
  if (open === -1) return false;
  const close = name.indexOf("}", open + 1);
  return close > open + 1;
}
