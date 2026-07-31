import type { GroupKey } from "../dispatch/groupKey.types";

/**
 * The group key for one process-manager instance (ADR-100, ADR-098
 * decision 1's "identified by `(processName, projectId, processKey)`" —
 * this dispatch plane names the tenant scope `tenantId`; the mapping from a
 * caller's `projectId` onto it is an application concern, not this
 * package's).
 *
 * A process's own commit is a read-modify-write over its persisted state —
 * find the row, evolve it, write it back — exactly the shape `scope:
 * aggregate` exists to serialise for a fold (ADR-100 decision 2: "two
 * concurrent applies to one aggregate produce a lost update that no
 * read-time dedup recovers"). The same is true of a process instance, so it
 * takes the same scope.
 *
 * There is no separate "aggregate type" to name for a process the way a fold
 * names the aggregate it folds: the entity a process instance is about IS
 * the process itself, so its own declared `name` fills that slot, and
 * `processKey` — the caller-supplied per-instance identity, e.g. a run id or
 * a trigger id — fills the aggregate id.
 *
 * Exported so a pipeline never re-assembles this by hand. Hand-rolled group
 * keys are exactly what ADR-100 replaces (its "the key is duplicated as
 * prose" finding).
 */
export function processGroupKey<Name extends string>(
  process: { readonly name: Name },
  args: { readonly tenantId: string; readonly processKey: string },
): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "processManager", name: process.name },
    scope: {
      kind: "aggregate",
      aggregateType: process.name,
      aggregateId: args.processKey,
    },
  };
}
