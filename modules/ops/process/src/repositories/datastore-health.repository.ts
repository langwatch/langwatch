/**
 * The install's own datastores as the checkup asks after them: whether each
 * answers. Every read resolves or throws; the check decides what a throw means.
 * Migration state is the upgrade ledger's (modules/ops/specs/upgrades-checkup.feature).
 */

export abstract class PostgresHealthRepository {
  /** The server's version string, which proves it answered. */
  abstract findServerVersion(): Promise<string>;
}

export abstract class ClickHouseHealthRepository {
  abstract ping(): Promise<void>;
}

export abstract class RedisHealthRepository {
  /** Where the connection points, host and port only: never a password. */
  abstract describeTarget(): string;
  abstract ping(): Promise<void>;
}
