const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_SEED = 0x9e3779b9;

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A bounded, dependency-free 64-bit content hash.
 *
 * Used where a value must identify content but must not *be* the content — an
 * event's idempotency key is part of `event_log`'s sort key, so embedding a
 * payload there puts megabytes into a primary index. `node:crypto` is barred in
 * this package's library code by the purity test, and a change-detecting hash
 * over our own serialised payloads does not need to be cryptographic.
 */
export function contentHash(value: string): string {
  const first = fnv1a(value, FNV_OFFSET_BASIS);
  const second = fnv1a(value, FNV_OFFSET_BASIS ^ SECOND_SEED);
  return (
    first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0")
  );
}
