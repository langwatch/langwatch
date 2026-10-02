import type {
  ClickHouseHealthRepository,
  MigrationLedgerRow,
  PostgresHealthRepository,
  RedisHealthRepository,
} from "../datastore-health.repository.ts";

/** A healthy Postgres holding the ledger and release folders a test wrote. */
export class MemoryPostgresHealthRepository implements PostgresHealthRepository {
  readonly ledger: MigrationLedgerRow[] = [];
  readonly releaseMigrations: string[] = [];

  private constructor() {}

  static create(): MemoryPostgresHealthRepository {
    return new MemoryPostgresHealthRepository();
  }

  async findServerVersion(): Promise<string> {
    return "memory";
  }

  async findMigrationLedger(): Promise<MigrationLedgerRow[]> {
    return [...this.ledger];
  }

  async findReleaseMigrationNames(): Promise<string[]> {
    return [...this.releaseMigrations];
  }
}

/** A healthy ClickHouse whose goose status is whatever a test wrote. */
export class MemoryClickHouseHealthRepository implements ClickHouseHealthRepository {
  migrationStatus = "";

  private constructor() {}

  static create(): MemoryClickHouseHealthRepository {
    return new MemoryClickHouseHealthRepository();
  }

  async ping(): Promise<void> {}

  async readMigrationStatus(): Promise<string> {
    return this.migrationStatus;
  }
}

/** A healthy Redis. */
export class MemoryRedisHealthRepository implements RedisHealthRepository {
  private constructor() {}

  static create(): MemoryRedisHealthRepository {
    return new MemoryRedisHealthRepository();
  }

  describeTarget(): string {
    return "memory";
  }

  async ping(): Promise<void> {}
}
