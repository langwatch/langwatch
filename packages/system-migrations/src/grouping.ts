import type { SystemMigration } from "./system-migration.ts";
import type { TenantSource } from "./tenant-source.ts";

/** One runner's worth of a pass: the tenants, and the migrations driven over
 *  them in the order they were registered. */
export interface TenantSourceBucket {
  tenants: TenantSource;
  migrations: SystemMigration[];
}

/**
 * Migrations bucketed by tenant source (`candidateTenants`, or `everyTenant`):
 * one runner per bucket, so a narrowed source never becomes another
 * migration's cohort too. Buckets are contiguous runs, preserving order.
 */
export function groupByTenantSource({
  migrations,
  everyTenant,
}: {
  migrations: readonly SystemMigration[];
  everyTenant: TenantSource;
}): TenantSourceBucket[] {
  const buckets: TenantSourceBucket[] = [];
  for (const migration of migrations) {
    const tenants = migration.candidateTenants ?? everyTenant;
    const open = buckets[buckets.length - 1];
    if (open?.tenants === tenants) open.migrations.push(migration);
    else buckets.push({ tenants, migrations: [migration] });
  }
  return buckets;
}
