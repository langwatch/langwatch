/**
 * The mutex a migration run holds for as long as it is migrating.
 *
 * Two runners are normal — a rolling deploy starts several pods, and a
 * developer's stack and a stray `pnpm -s task prisma-migrate` overlap all the
 * time — but two runners rebuilding the same schema at once is not. The
 * second one waits here, and then finds nothing pending.
 */
export abstract class MigrationLockPort {
  /** Takes the lock if it is free right now; never blocks. */
  abstract tryAcquire(): Promise<boolean>;
  /** Blocks until the lock is held. */
  abstract acquire(): Promise<void>;
  /** Releases the lock and whatever connection held it. Safe to call unheld. */
  abstract release(): Promise<void>;
}

/** The runner that has nothing to contend for: no database, nothing to lock. */
export class UnlockedMigrationLock extends MigrationLockPort {
  tryAcquire(): Promise<boolean> {
    return Promise.resolve(true);
  }

  acquire(): Promise<void> {
    return Promise.resolve();
  }

  release(): Promise<void> {
    return Promise.resolve();
  }
}
