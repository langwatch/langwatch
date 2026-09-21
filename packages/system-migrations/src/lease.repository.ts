/**
 * Named leases for the runner's per-organization claims: one process works
 * one organization at a time, while any number of processes share the
 * fleet. The app implements this on Redis (`SET NX PX` + delete); tests
 * use an in-memory fake.
 *
 * Losing a claim mid-tenant is safe by construction - every migration is
 * idempotent and the state machine is re-entrant - so the runner treats a
 * failed renewal as "leave this organization to the new holder", never as
 * corruption.
 */
export interface MigrationLeaseRepository {
  /** True when this process now holds the lease. */
  acquire(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Extend a held lease; false means it was lost (or expired). */
  renew(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Best-effort release so the next boot need not wait out the TTL. */
  release(args: { name: string }): Promise<void>;
}
