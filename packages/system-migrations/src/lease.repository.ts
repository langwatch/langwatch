/**
 * The single-driver lease: one process runs a migration pass at a time,
 * fleet-wide. The app implements this on Redis (`SET NX PX` + delete);
 * tests use an in-memory fake.
 *
 * Losing the lease mid-pass is safe by construction - every migration is
 * idempotent and the state machine is re-entrant - so the runner treats a
 * failed renewal as "stop early", never as corruption.
 */
export interface MigrationLeaseRepository {
  /** True when this process now holds the lease. */
  acquire(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Extend a held lease; false means it was lost (or expired). */
  renew(args: { name: string; ttlMs: number }): Promise<boolean>;

  /** Best-effort release so the next boot need not wait out the TTL. */
  release(args: { name: string }): Promise<void>;
}
