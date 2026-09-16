/**
 * The mutex a migration run holds while migrating. Two runners are normal -
 * a rolling deploy starts several pods - but two rebuilding the same schema
 * at once is not; the second one waits here, then finds nothing pending.
 */
export abstract class MigrationLock {
  /** Takes the lock if it is free right now; never blocks. */
  abstract tryAcquire(): Promise<boolean>;
  /** Blocks until the lock is held. */
  abstract acquire(): Promise<void>;
  /** Releases the lock and whatever connection held it. Safe to call unheld. */
  abstract release(): Promise<void>;
}

/** The runner that has nothing to contend for: no database, nothing to lock. */
export class UnlockedMigrationLock extends MigrationLock {
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
