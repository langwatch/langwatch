import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/**
 * The `canonicalLogStorage` map projection's mount (ADR-106).
 *
 * `map` + `append`: each event independently produces one row, and duplicate
 * rows collapse at the store (content-addressed `recordId` — see
 * `table.ts`/`store.ts`), so `append` is the correct store kind rather than
 * `merge` (closed to new adopters regardless) or `replace` (nothing here
 * reads prior state back).
 *
 * `scope: partition`, `collapse: batch`: the whole reason this pipeline
 * shards (`groupKey.ts`) is so a delivery can gather several records into one
 * bulk write. `collapse: none` would still be legal here but would silently
 * give up the batching the shard scope exists to enable.
 */
export const canonicalLogStorageMount: Mount = {
  projection: "map",
  store: "append",
  scope: "partition",
  collapse: "batch",
};

/**
 * Fails composition loudly if the mount above is ever edited into an illegal
 * shape (ADR-106 decision 3: refusal happens at composition, not on the
 * first delivery). Called once, at module load, rather than left for a
 * caller to remember — the whole point of a mount descriptor is that its
 * legality does not depend on who is reading it.
 */
export function assertCanonicalLogStorageMountIsLegal(): void {
  const violations = validateMount(canonicalLogStorageMount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `log-processing's canonicalLogStorage mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      {
        pipeline: "log_processing",
        projection: "canonicalLogStorage",
        violations,
      },
    );
  }
}
