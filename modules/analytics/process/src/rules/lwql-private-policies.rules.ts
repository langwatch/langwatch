import type { LwqlRowPolicy } from "../repositories/langwatch-ql-provisioning.repository.ts";

/**
 * The `database.table` names among `tables` that `reader` is not guarded on: no row policy for
 * it, or one applying to everyone or all but some, which would OR with its own.
 * The check matches the reader's own name only; another reader's policy is not looked at.
 */
export function unguardedTables({
  policies,
  tables,
  reader,
}: {
  policies: readonly LwqlRowPolicy[];
  tables: readonly string[];
  reader: string;
}): string[] {
  return tables.filter((table) => {
    const own = policies.filter((policy) => policy.table === table);
    const isOwn = own.some((policy) => policy.appliesTo.includes(reader));
    const isBroad = own.some((policy) => policy.appliesToAll || policy.hasExceptions);
    return !isOwn || isBroad;
  });
}
