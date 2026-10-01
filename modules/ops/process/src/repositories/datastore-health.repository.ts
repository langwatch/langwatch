/**
 * The install's own datastores as the checkup asks after them: whether each
 * answers, and what Postgres's migration ledger holds. Every read resolves or
 * throws; the check decides what a throw means.
 */

/** One row of Prisma's `_prisma_migrations` ledger. */
export interface MigrationLedgerRow {
  readonly name: string;
  readonly finished: boolean;
  readonly rolledBack: boolean;
}

export abstract class PostgresHealthRepository {
  /** The server's version string, which proves it answered. */
  abstract findServerVersion(): Promise<string>;
  abstract findMigrationLedger(): Promise<MigrationLedgerRow[]>;
  /** The migration folders this release ships, sorted; empty where they are not on this install. */
  abstract findReleaseMigrationNames(): Promise<string[]>;
}

export abstract class ClickHouseHealthRepository {
  abstract ping(): Promise<void>;
  /** Goose's own status output; throws where the binary or the connection is absent. */
  abstract readMigrationStatus(): Promise<string>;
}

export abstract class RedisHealthRepository {
  /** Where the connection points, host and port only: never a password. */
  abstract describeTarget(): string;
  abstract ping(): Promise<void>;
}
