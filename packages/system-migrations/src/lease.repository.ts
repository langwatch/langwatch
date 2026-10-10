/**
 * Named leases for the runner's per-organization claims, so any number of
 * processes share the fleet. Losing a claim mid-tenant is safe by
 * construction, so a failed renewal is treated as handing off, never corruption.
 */
export interface MigrationLeaseRepository {
  /** True when this process now holds the lease. */
  acquire(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Extend a held lease; false means it was lost (or expired). */
  renew(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Best-effort release so the next boot need not wait out the TTL. */
  release(args: { name: string }): Promise<void>;
}
