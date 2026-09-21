import type { SystemMigration } from "./system-migration";
import type { TenantSource } from "./tenant-source";

/** One runner's worth of a pass: the tenants, and the migrations driven over
 *  them in the order they were registered. */
export interface TenantSourceBucket {
  tenants: TenantSource;
  migrations: SystemMigration[];
}

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
 * Buckets are CONTIGUOUS RUNS, not one bucket per distinct source, so
 * registration order survives grouping whatever order the sources appear in.
 * Keying a map by the source would reorder `[A(s1), B(s2), C(s1)]` into
 * `A, C, B`: C would overtake B by being merged into A's bucket, and a
 * migration that must follow another would silently stop doing so. A source
 * that appears twice is paged twice, which is the price of the guarantee and
 * is only ever paid by a registration that actually interleaves.
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
