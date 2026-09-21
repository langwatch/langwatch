import type { SystemMigration } from "./system-migration";
import type { TenantSource } from "./tenant-source";

/**
 * Migrations bucketed by the tenants each is driven over: the set a migration
 * declares in `candidateTenants`, or `everyTenant` for the ones that declare
 * nothing.
 *
 * A pass runs one runner per bucket rather than one runner for all of them,
 * because a runner drives EVERY migration it holds over the ONE source it
 * holds. Sharing a source means the narrowest declaration silently becomes
 * everybody's cohort — a backfill that must reach every tenant would stop
 * reaching the ones its narrowed neighbour has no interest in.
 *
 * Insertion order is preserved, both across buckets and within them, so the
 * pass still runs migrations in registration order.
 */
export function groupByTenantSource({
  migrations,
  everyTenant,
}: {
  migrations: readonly SystemMigration[];
  everyTenant: TenantSource;
}): Map<TenantSource, SystemMigration[]> {
  const grouped = new Map<TenantSource, SystemMigration[]>();
  for (const migration of migrations) {
    const tenants = migration.candidateTenants ?? everyTenant;
    const group = grouped.get(tenants);
    if (group) group.push(migration);
    else grouped.set(tenants, [migration]);
  }
  return grouped;
}
